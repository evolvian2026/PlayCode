import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { assessmentAttempts, assessments, attemptSnapshots, authSessions, loginCodes, ltiDeepLinks, ltiNonces, notifications, pushSubscriptions, rateLimits, samlRequests, talentInvites, tenants } from "../db/schema";
import { deleteObject } from "../lib/storage";
import { pruneJobRuns } from "./jobs";

// Nightly data retention (the DPDP Act's storage limitation: keep personal
// data only as long as its purpose needs). Webcam snapshots go a set number of
// days after their test closes; sign-in leftovers, old notifications and
// unused push subscriptions go on fixed schedules. Learning records, results,
// certificates and the audit trail are kept: they are the service itself.

const DAY_MS = 86_400_000;
export const DEFAULT_SNAPSHOT_DAYS = 90;

export const RETENTION = {
  /** Signed-out sessions, and sessions unused for this long (tokens last 12 hours, so these are dead). */
  sessionsDays: 30,
  notificationsDays: 365,
  /** Push subscriptions that haven't received anything in this long. */
  pushDays: 180,
  jobRunsDays: 90,
  /** Talent-pool invitations, answered or not. */
  talentInvitesDays: 730,
} as const;

export async function runRetention(db: Db, now: Date) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);

  // Webcam snapshots: per institution, N days after the test closed.
  let snapshots = 0;
  for (const t of await db.select({ id: tenants.id, settings: tenants.settings }).from(tenants)) {
    const days = t.settings.snapshotRetentionDays ?? DEFAULT_SNAPSHOT_DAYS;
    const closed = await db
      .select({ id: assessments.id })
      .from(assessments)
      .where(and(eq(assessments.tenantId, t.id), lt(assessments.closeAt, ago(days))));
    if (closed.length === 0) continue;
    const attempts = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(inArray(assessmentAttempts.assessmentId, closed.map((a) => a.id)));
    if (attempts.length === 0) continue;
    const rows = await db.select().from(attemptSnapshots).where(inArray(attemptSnapshots.attemptId, attempts.map((a) => a.id)));
    for (const r of rows) {
      // Delete the photo first: a row left behind can be retried, a photo left behind can't be found.
      await deleteObject(r.storageKey);
      await db.delete(attemptSnapshots).where(eq(attemptSnapshots.id, r.id));
      snapshots++;
    }
  }

  const count = async (p: Promise<unknown[]>) => (await p).length;
  const result = {
    snapshots,
    loginCodes: await count(db.delete(loginCodes).where(or(lt(loginCodes.expiresAt, ago(1)), isNotNull(loginCodes.usedAt))).returning({ id: loginCodes.id })),
    sessions: await count(
      db
        .delete(authSessions)
        .where(or(lt(authSessions.revokedAt, ago(RETENTION.sessionsDays)), and(isNull(authSessions.revokedAt), lt(authSessions.lastSeenAt, ago(RETENTION.sessionsDays)))))
        .returning({ id: authSessions.id }),
    ),
    notifications: await count(db.delete(notifications).where(lt(notifications.createdAt, ago(RETENTION.notificationsDays))).returning({ id: notifications.id })),
    pushSubscriptions: await count(
      db
        .delete(pushSubscriptions)
        .where(or(lt(pushSubscriptions.lastPushedAt, ago(RETENTION.pushDays)), and(isNull(pushSubscriptions.lastPushedAt), lt(pushSubscriptions.createdAt, ago(RETENTION.pushDays)))))
        .returning({ id: pushSubscriptions.id }),
    ),
    rateLimits: await count(db.delete(rateLimits).where(lt(rateLimits.windowStart, ago(1))).returning({ key: rateLimits.key })),
    samlRequests: await count(db.delete(samlRequests).where(lt(samlRequests.createdAt, ago(1))).returning({ id: samlRequests.id })),
    ltiNonces: await count(db.delete(ltiNonces).where(lt(ltiNonces.expiresAt, now)).returning({ nonce: ltiNonces.nonce })),
    ltiDeepLinks: await count(db.delete(ltiDeepLinks).where(lt(ltiDeepLinks.createdAt, ago(1))).returning({ id: ltiDeepLinks.id })),
    talentInvites: await count(db.delete(talentInvites).where(lt(talentInvites.createdAt, ago(RETENTION.talentInvitesDays))).returning({ id: talentInvites.id })),
    jobRuns: await pruneJobRuns(db, now),
  };
  return result;
}
