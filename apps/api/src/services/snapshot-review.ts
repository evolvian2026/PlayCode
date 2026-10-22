import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import type { IntegrityEventType } from "@playcode/core";
import type { Db } from "../db/client";
import { assessmentAttempts, assessments, attemptSnapshots, tenants } from "../db/schema";
import { aiProvider } from "../lib/ai";
import { getObject } from "../lib/storage";
import { recordEvents } from "./assessments";
import { recordAiUsage } from "./coach";

// Level 3 proctoring: every webcam snapshot is looked at by an AI model that
// counts faces and spots phones or a second person. Findings become integrity
// events with the snapshot as evidence, which raise the attempt's risk score
// for a human proctor to review. Nothing is decided automatically.

const inFlight = new Set<Promise<void>>();

/** Start a review without making the student wait. Failures are recorded on the snapshot and retried by the sweep. */
export function queueSnapshotReview(db: Db, snapshotId: string, tenantId: string): void {
  const p = reviewSnapshot(db, snapshotId, tenantId, new Date())
    .catch(() => {})
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/** Tests: wait for background reviews to finish. */
export async function settleSnapshotReviews(): Promise<void> {
  while (inFlight.size) await Promise.all([...inFlight]);
}

export async function reviewSnapshot(db: Db, snapshotId: string, tenantId: string, now: Date): Promise<void> {
  const provider = aiProvider();
  if (!provider) return;
  const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  if (tenant?.settings.aiProctoring === false) return;
  const [snap] = await db.select().from(attemptSnapshots).where(eq(attemptSnapshots.id, snapshotId));
  if (!snap || snap.reviewedAt) return;
  const image = await getObject(snap.storageKey);
  if (!image) return;

  let review;
  try {
    const res = await provider.reviewSnapshot({ image, mediaType: snap.contentType as "image/jpeg" | "image/png" | "image/webp" });
    await recordAiUsage(db, { tenantId, userId: null, feature: "snapshot_review", usage: res.usage, now });
    review = res.value;
  } catch (err) {
    await db.update(attemptSnapshots).set({ review: { error: (err as Error).message.slice(0, 200) } }).where(eq(attemptSnapshots.id, snap.id));
    throw err;
  }
  // Claim the snapshot so a concurrent sweep doesn't record the same findings twice.
  const claimed = await db
    .update(attemptSnapshots)
    .set({ review, reviewedAt: now })
    .where(and(eq(attemptSnapshots.id, snap.id), isNull(attemptSnapshots.reviewedAt)))
    .returning({ id: attemptSnapshots.id });
  if (claimed.length === 0) return;

  const when = snap.at.toISOString().slice(11, 19);
  const events: { type: IntegrityEventType; detail: string }[] = [];
  if (review.faces === 0) events.push({ type: "no_face", detail: `Snapshot ${when}: nobody in view` });
  if (review.faces > 1) events.push({ type: "multiple_faces", detail: `Snapshot ${when}: ${review.faces} faces` });
  if (review.phone) events.push({ type: "phone_visible", detail: `Snapshot ${when}: phone visible` });
  if (review.otherPerson && review.faces <= 1) events.push({ type: "other_person", detail: `Snapshot ${when}: ${review.note || "someone else present"}` });
  // Keep a pointer to the evidence in the detail so the proctor can open the photo.
  await recordEvents(db, { id: snap.attemptId }, events.map((e) => ({ ...e, detail: `${e.detail} [${snap.id}]` })), now);
}

/** Backstop job: review snapshots of level-3 tests that were missed (server restart, AI outage) in the last day. Recent ones are left to their in-flight review. */
export async function reviewPendingSnapshots(db: Db, now: Date, limit = 200): Promise<number> {
  const rows = await db
    .select({ id: attemptSnapshots.id, tenantId: assessments.tenantId })
    .from(attemptSnapshots)
    .innerJoin(assessmentAttempts, eq(assessmentAttempts.id, attemptSnapshots.attemptId))
    .innerJoin(assessments, eq(assessments.id, assessmentAttempts.assessmentId))
    .where(and(isNull(attemptSnapshots.reviewedAt), eq(assessments.proctorLevel, 3), gte(attemptSnapshots.at, new Date(now.getTime() - 86_400_000)), lte(attemptSnapshots.at, new Date(now.getTime() - 5 * 60_000))))
    .orderBy(asc(attemptSnapshots.at))
    .limit(limit);
  let done = 0;
  for (const r of rows) {
    try {
      await reviewSnapshot(db, r.id, r.tenantId, now);
      done++;
    } catch {
      // Left for the next run.
    }
  }
  return done;
}
