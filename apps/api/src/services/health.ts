import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { assessHealth, type HealthStatus } from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { aiUsage, assignments, authSessions, invoices, memberships, responses, tenants, users } from "../db/schema";

// Customer health: for each institution or company account, whether students
// and staff are using PlayCode, and what puts the renewal at risk. PlayCode
// staff see every customer; a partner sees its own colleges.

const DAY_MS = 86_400_000;

type Count = { tenantId: string | null; n: number };
const byTenant = (rows: Count[]) => new Map(rows.map((r) => [r.tenantId, Number(r.n)]));

export async function customerHealth(db: DbOrTx, args: { partnerId: string | null; now: Date }) {
  const { now } = args;
  const all = await db.select().from(tenants);
  const name = new Map(all.map((t) => [t.id, t.name]));
  const list = all.filter((t) => t.type !== "partner" && (args.partnerId === null || t.parentId === args.partnerId));
  if (list.length === 0) return { summary: { customers: 0, healthy: 0, watch: 0, at_risk: 0, renewalsIn90Days: 0, students: 0, weeklyActive: 0 }, customers: [] };
  const ids = list.map((t) => t.id);
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [students, active7, activePrev, answers7, staff7, staff14, assignments30, aiTokens, overdue] = await Promise.all([
    db
      .select({ tenantId: memberships.tenantId, n: sql<number>`count(distinct ${memberships.userId})::int` })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(inArray(memberships.tenantId, ids), eq(memberships.role, "student"), eq(users.status, "active")))
      .groupBy(memberships.tenantId),
    db.select({ tenantId: responses.tenantId, n: sql<number>`count(distinct ${responses.userId})::int` }).from(responses).where(and(inArray(responses.tenantId, ids), gte(responses.createdAt, since(7)))).groupBy(responses.tenantId),
    // The same week a month ago, for the trend.
    db
      .select({ tenantId: responses.tenantId, n: sql<number>`count(distinct ${responses.userId})::int` })
      .from(responses)
      .where(and(inArray(responses.tenantId, ids), gte(responses.createdAt, since(35)), lt(responses.createdAt, since(28))))
      .groupBy(responses.tenantId),
    db.select({ tenantId: responses.tenantId, n: sql<number>`count(*)::int` }).from(responses).where(and(inArray(responses.tenantId, ids), gte(responses.createdAt, since(7)))).groupBy(responses.tenantId),
    staffSeen(db, ids, since(7)),
    staffSeen(db, ids, since(14)),
    db.select({ tenantId: assignments.tenantId, n: sql<number>`count(*)::int` }).from(assignments).where(and(inArray(assignments.tenantId, ids), gte(assignments.createdAt, since(30)))).groupBy(assignments.tenantId),
    db
      .select({ tenantId: aiUsage.tenantId, n: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint` })
      .from(aiUsage)
      .where(and(inArray(aiUsage.tenantId, ids), gte(aiUsage.createdAt, monthStart)))
      .groupBy(aiUsage.tenantId),
    db
      .select({ tenantId: invoices.tenantId, oldest: sql<Date>`min(${invoices.dueAt})` })
      .from(invoices)
      .where(and(eq(invoices.status, "issued"), lt(invoices.dueAt, now)))
      .groupBy(invoices.tenantId),
  ]);
  const maps = { students: byTenant(students), active7: byTenant(active7), activePrev: byTenant(activePrev), answers7: byTenant(answers7), staff7, staff14, assignments30: byTenant(assignments30), ai: byTenant(aiTokens) };
  const overdueSince = new Map(overdue.map((o) => [o.tenantId, new Date(o.oldest)]));

  const customers = list.map((t) => {
    const n = maps.students.get(t.id) ?? 0;
    const wau = maps.active7.get(t.id) ?? 0;
    const prev = maps.activePrev.get(t.id) ?? 0;
    // Colleges under a partner are billed through the partner.
    const billed = t.parentId ?? t.id;
    const oldest = overdueSince.get(billed);
    const overdueDays = oldest ? Math.floor((now.getTime() - oldest.getTime()) / DAY_MS) : 0;
    const licenceDaysLeft = t.validUntil ? Math.ceil((new Date(`${t.validUntil}T23:59:59Z`).getTime() - now.getTime()) / DAY_MS) : null;
    const health = assessHealth({ students: n, seats: t.seats, weeklyActive: wau, staffActive7: maps.staff7.get(t.id) ?? 0, staffActive14: maps.staff14.get(t.id) ?? 0, licenceDaysLeft, overdueDays });
    return {
      id: t.id,
      name: t.name,
      type: t.type,
      partner: t.parentId ? (name.get(t.parentId) ?? null) : null,
      plan: t.plan,
      seats: t.seats,
      students: n,
      weeklyActive: wau,
      weeklyActivePct: n ? Math.round((wau / n) * 100) : 0,
      /** Change in weekly active % against the same week a month ago, in points. */
      trend: n ? Math.round((wau / n) * 100) - Math.round((prev / n) * 100) : 0,
      answersPerActive: wau ? Math.round(((maps.answers7.get(t.id) ?? 0) / wau) * 10) / 10 : 0,
      staffActive7: maps.staff7.get(t.id) ?? 0,
      assignments30: maps.assignments30.get(t.id) ?? 0,
      aiTokensThisMonth: maps.ai.get(t.id) ?? 0,
      validUntil: t.validUntil,
      licenceDaysLeft,
      overdueDays,
      status: health.status,
      reasons: health.reasons,
    };
  });
  const order: Record<HealthStatus, number> = { at_risk: 0, watch: 1, healthy: 2 };
  customers.sort((a, b) => order[a.status] - order[b.status] || a.weeklyActivePct - b.weeklyActivePct || a.name.localeCompare(b.name));
  return {
    summary: {
      customers: customers.length,
      healthy: customers.filter((c) => c.status === "healthy").length,
      watch: customers.filter((c) => c.status === "watch").length,
      at_risk: customers.filter((c) => c.status === "at_risk").length,
      renewalsIn90Days: customers.filter((c) => c.licenceDaysLeft !== null && c.licenceDaysLeft >= 0 && c.licenceDaysLeft <= 90).length,
      students: customers.reduce((a, c) => a + c.students, 0),
      weeklyActive: customers.reduce((a, c) => a + c.weeklyActive, 0),
    },
    customers,
  };
}

/** Staff (anyone but students) per tenant who used the console since a date. */
async function staffSeen(db: DbOrTx, tenantIds: string[], since: Date): Promise<Map<string | null, number>> {
  const rows = await db
    .select({ tenantId: memberships.tenantId, n: sql<number>`count(distinct ${memberships.userId})::int` })
    .from(memberships)
    .innerJoin(authSessions, eq(authSessions.userId, memberships.userId))
    .where(and(inArray(memberships.tenantId, tenantIds), ne(memberships.role, "student"), gte(authSessions.lastSeenAt, since)))
    .groupBy(memberships.tenantId);
  return byTenant(rows);
}

export function healthCsv(data: Awaited<ReturnType<typeof customerHealth>>): string {
  const esc = (v: unknown) => {
    const t = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const header = ["customer", "partner", "plan", "seats", "students", "weekly_active", "weekly_active_pct", "trend_points", "answers_per_active", "staff_active_7d", "assignments_30d", "ai_tokens_month", "valid_until", "overdue_days", "status", "reasons"];
  return [
    header.join(","),
    ...data.customers.map((c) =>
      [c.name, c.partner, c.plan, c.seats, c.students, c.weeklyActive, c.weeklyActivePct, c.trend, c.answersPerActive, c.staffActive7, c.assignments30, c.aiTokensThisMonth, c.validUntil, c.overdueDays, c.status, c.reasons.join("; ")].map(esc).join(","),
    ),
  ].join("\n");
}
