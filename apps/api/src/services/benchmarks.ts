import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { BENCHMARK_MIN_STUDENTS, compareWithPeers, localDate, quantile, type BenchmarkValues } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { institutionMetrics, memberships, responses, tenants, users } from "../db/schema";
import { readinessFor } from "./analytics";
import { tenantLicence } from "./licence";

// Peer benchmarks. A nightly job snapshots each institution's aggregates
// (median readiness, weekly activity); an institution then sees where it
// stands among the others, as medians, top quartiles and a coarse percentile,
// never another institution's name or numbers.

const DAY_MS = 86_400_000;
/** Peers' snapshots count if taken within this long of the institution's own. */
const SNAPSHOT_WINDOW_MS = 3 * DAY_MS;
const KEEP_DAYS = 400;

/** One institution's aggregates now, or null if it has too few students to measure. */
export async function measureInstitution(db: DbOrTx, tenantId: string, now: Date): Promise<{ students: number; values: BenchmarkValues } | null> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return null;
  const ids = (
    await db
      .selectDistinct({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(users.tenantId, tenantId), eq(memberships.role, "student"), isNull(memberships.graduatedAt), eq(users.status, "active")))
  ).map((r) => r.id);
  if (ids.length < BENCHMARK_MIN_STUDENTS) return null;
  const readiness = await readinessFor(db, ids, localDate(now, tenant.timeZone));
  const activity = await db
    .select({ userId: responses.userId, n: sql<number>`count(*)::int` })
    .from(responses)
    .where(and(inArray(responses.userId, ids), gte(responses.createdAt, new Date(now.getTime() - 7 * DAY_MS))))
    .groupBy(responses.userId);
  const answers = activity.reduce((a, r) => a + r.n, 0);
  return {
    students: ids.length,
    values: {
      serviceReadiness: quantile(ids.map((id) => readiness.get(id)?.service ?? 0), 0.5),
      productReadiness: quantile(ids.map((id) => readiness.get(id)?.product ?? 0), 0.5),
      weeklyActivePct: (activity.length / ids.length) * 100,
      answersPerActive: activity.length ? answers / activity.length : 0,
    },
  };
}

/** Nightly: snapshot every institution with an active licence and enough students. */
export async function snapshotBenchmarks(db: Db, now: Date) {
  let measured = 0;
  let skipped = 0;
  for (const t of await db.select({ id: tenants.id, timeZone: tenants.timeZone }).from(tenants).where(eq(tenants.type, "institution"))) {
    const m = (await tenantLicence(db, t.id, now)).state === "expired" ? null : await measureInstitution(db, t.id, now);
    if (!m) {
      skipped++;
      continue;
    }
    const day = localDate(now, t.timeZone);
    await db
      .insert(institutionMetrics)
      .values({ tenantId: t.id, day, students: m.students, values: m.values, createdAt: now })
      .onConflictDoUpdate({ target: [institutionMetrics.tenantId, institutionMetrics.day], set: { students: m.students, values: m.values, createdAt: now } });
    measured++;
  }
  const old = await db.delete(institutionMetrics).where(sql`${institutionMetrics.createdAt} < ${new Date(now.getTime() - KEEP_DAYS * DAY_MS)}`).returning({ id: institutionMetrics.tenantId });
  return { measured, skipped, pruned: old.length };
}

/** Where an institution stands among its peers, from the latest snapshots. */
export async function institutionBenchmark(db: DbOrTx, tenantId: string) {
  const [own] = await db.select().from(institutionMetrics).where(eq(institutionMetrics.tenantId, tenantId)).orderBy(desc(institutionMetrics.createdAt)).limit(1);
  if (!own) return { measured: false as const, minStudents: BENCHMARK_MIN_STUDENTS };
  // Each peer's latest snapshot near our own.
  const near = await db
    .select()
    .from(institutionMetrics)
    .where(
      and(
        ne(institutionMetrics.tenantId, tenantId),
        gte(institutionMetrics.createdAt, new Date(own.createdAt.getTime() - SNAPSHOT_WINDOW_MS)),
        sql`${institutionMetrics.createdAt} <= ${new Date(own.createdAt.getTime() + SNAPSHOT_WINDOW_MS)}`,
      ),
    )
    .orderBy(desc(institutionMetrics.createdAt));
  const latest = new Map<string, BenchmarkValues>();
  for (const r of near) if (!latest.has(r.tenantId)) latest.set(r.tenantId, r.values);
  const peers = [...latest.values()];
  return { measured: true as const, day: own.day, students: own.students, peerCount: peers.length, rows: compareWithPeers(own.values, peers) };
}
