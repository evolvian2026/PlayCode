import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { masteryFromRating, readinessBand } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { memberships, orgUnits, placementApplications, placementDrives, responses, skillRatings, skills, users, type ApiScope } from "../db/schema";
import { HttpError } from "../lib/errors";
import { parse } from "../lib/http";
import { readinessFor } from "../services/analytics";
import { getTenant, tenantToday } from "../services/tenant";

// Reporting API for BI tools (Power BI, Tableau, Looker Studio, Excel).
// Read-only, scope reports:read. Each endpoint returns flat rows; add
// ?format=csv for CSV. Row lists page with ?limit and ?cursor (next_cursor).

const DAY_MS = 86_400_000;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const format = z.enum(["json", "csv"]).default("json");
const page = z.object({ limit: z.coerce.number().int().min(1).max(5000).default(1000), cursor: z.string().max(200).optional(), format });

const encode = (...parts: string[]) => Buffer.from(parts.join("|")).toString("base64url");
function decode(cursor: string | undefined, n: number): string[] | null {
  if (!cursor) return null;
  const parts = Buffer.from(cursor, "base64url").toString().split("|");
  if (parts.length !== n || parts.some((p) => !p)) throw new HttpError(400, "bad_cursor", "Invalid cursor");
  return parts;
}

function send(reply: FastifyReply, fmt: "json" | "csv", name: string, rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  if (fmt === "json") return { data: rows, ...extra };
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"` : t;
  };
  const cols = rows.length ? Object.keys(rows[0]!) : [];
  if (extra.next_cursor) reply.header("x-next-cursor", String(extra.next_cursor));
  reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${name}.csv"`);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/** Each active student's section (or other unit) and its parents' names; graduates only when asked for (for history). */
async function studentUnits(tenantId: string, opts: { graduated?: boolean } = {}) {
  const units = await db.select().from(orgUnits).where(eq(orgUnits.tenantId, tenantId));
  const byId = new Map(units.map((u) => [u.id, u]));
  const rows = await db
    .select({ userId: memberships.userId, unitId: memberships.orgUnitId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student"), eq(users.status, "active"), opts.graduated ? undefined : isNull(memberships.graduatedAt)));
  const out = new Map<string, { unitId: string; unit: string; department: string | null }>();
  for (const r of rows) {
    if (!r.unitId || out.has(r.userId)) continue;
    let root = byId.get(r.unitId);
    while (root?.parentId && byId.get(root.parentId)) root = byId.get(root.parentId);
    out.set(r.userId, { unitId: r.unitId, unit: byId.get(r.unitId)?.name ?? "", department: root && root.id !== r.unitId ? root.name : null });
  }
  return out;
}

export function reportRoutes(api: FastifyInstance, requireScope: (s: ApiScope) => (req: FastifyRequest) => Promise<void>) {
  const scope = { preHandler: requireScope("reports:read") };

  /** Practice per day (tenant time zone), overall or per section: active students, answers, accuracy, minutes. */
  api.get("/v1/reports/engagement/daily", scope, async (req, reply) => {
    const q = parse(z.object({ from: day, to: day, group_by: z.enum(["tenant", "unit"]).default("tenant"), format }), req.query);
    const tenant = await getTenant(db, req.api.tenantId);
    const from = new Date(`${q.from}T00:00:00Z`);
    const to = new Date(`${q.to}T00:00:00Z`);
    if (to < from || to.getTime() - from.getTime() > 366 * DAY_MS) throw new HttpError(400, "bad_range", "Use a range of up to 366 days, with from on or before to");
    // Widen by a day each side, then keep the days that fall in range in the tenant's time zone.
    const dayExpr = sql<string>`to_char(${responses.createdAt} at time zone ${tenant.timeZone}, 'YYYY-MM-DD')`;
    const rows = await db
      .select({ day: dayExpr, userId: responses.userId, answers: sql<number>`count(*)::int`, correct: sql<number>`sum(case when ${responses.correct} then 1 else 0 end)::int`, ms: sql<number>`sum(${responses.timeMs})::bigint` })
      .from(responses)
      .where(and(eq(responses.tenantId, req.api.tenantId), gte(responses.createdAt, new Date(from.getTime() - DAY_MS)), lt(responses.createdAt, new Date(to.getTime() + 2 * DAY_MS))))
      .groupBy(sql`1`, responses.userId);
    const inRange = rows.filter((r) => r.day >= q.from && r.day <= q.to);
    const units = q.group_by === "unit" ? await studentUnits(req.api.tenantId, { graduated: true }) : null;
    const groups = new Map<string, { date: string; unit_id?: string | null; unit?: string | null; department?: string | null; active_students: number; answers: number; correct: number; ms: number }>();
    for (const r of inRange) {
      const u = units?.get(r.userId);
      const key = units ? `${r.day}|${u?.unitId ?? ""}` : r.day;
      const g = groups.get(key) ?? { date: r.day, ...(units ? { unit_id: u?.unitId ?? null, unit: u?.unit ?? null, department: u?.department ?? null } : {}), active_students: 0, answers: 0, correct: 0, ms: 0 };
      g.active_students++;
      g.answers += r.answers;
      g.correct += r.correct;
      g.ms += Number(r.ms);
      groups.set(key, g);
    }
    const data = [...groups.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.unit ?? "").localeCompare(String(b.unit ?? "")))
      .map(({ ms, ...g }) => ({ ...g, accuracy_pct: g.answers ? Math.round((g.correct / g.answers) * 100) : null, practice_minutes: Math.round(ms / 60_000) }));
    return send(reply, q.format, "engagement-daily", data, { time_zone: tenant.timeZone });
  });

  /** One row per student and skill they have practised. */
  api.get("/v1/reports/skill-mastery", scope, async (req, reply) => {
    const q = parse(page, req.query);
    const after = decode(q.cursor, 2);
    const rows = await db
      .select({ userId: skillRatings.userId, rollNo: users.rollNo, skillId: skillRatings.skillId, skill: skills.name, topic: skills.topicName, rating: skillRatings.rating, attempts: skillRatings.attempts, correct: skillRatings.correct, last: skillRatings.lastPractisedAt })
      .from(skillRatings)
      .innerJoin(users, eq(users.id, skillRatings.userId))
      .innerJoin(skills, eq(skills.id, skillRatings.skillId))
      .where(
        and(
          eq(users.tenantId, req.api.tenantId),
          eq(users.status, "active"),
          after ? or(gt(skillRatings.userId, after[0]!), and(eq(skillRatings.userId, after[0]!), gt(skillRatings.skillId, after[1]!))) : undefined,
        ),
      )
      .orderBy(asc(skillRatings.userId), asc(skillRatings.skillId))
      .limit(q.limit + 1);
    const pageRows = rows.slice(0, q.limit);
    const last = pageRows.at(-1);
    const data = pageRows.map((r) => ({
      user_id: r.userId,
      roll_no: r.rollNo,
      skill_id: r.skillId,
      skill: r.skill,
      topic: r.topic,
      mastery: masteryFromRating(r.rating),
      attempts: r.attempts,
      accuracy_pct: r.attempts ? Math.round((r.correct / r.attempts) * 100) : null,
      last_practised: r.last,
    }));
    return send(reply, q.format, "skill-mastery", data, { next_cursor: rows.length > q.limit && last ? encode(last.userId, last.skillId) : null });
  });

  /** Readiness per student today, with their section and department. */
  api.get("/v1/reports/readiness", scope, async (req, reply) => {
    const q = parse(page, req.query);
    const after = decode(q.cursor, 1);
    const tenant = await getTenant(db, req.api.tenantId);
    const units = await studentUnits(req.api.tenantId);
    // Students are paged by id; a tenant has thousands at most, so the id list is held in memory.
    const ids = [...units.keys()].sort().filter((id) => !after || id > after[0]!);
    const pageIds = ids.slice(0, q.limit);
    const people = pageIds.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, pageIds)) : [];
    const pageRows = people.sort((a, b) => a.id.localeCompare(b.id));
    const scores = await readinessFor(db, pageRows.map((p) => p.id), tenantToday(tenant, new Date()));
    const data = pageRows.map((p) => {
      const s = scores.get(p.id) ?? {};
      return {
        user_id: p.id,
        name: p.name,
        roll_no: p.rollNo,
        unit: units.get(p.id)?.unit ?? null,
        department: units.get(p.id)?.department ?? null,
        service_readiness: s.service ?? 0,
        service_band: readinessBand(s.service ?? 0),
        product_readiness: s.product ?? 0,
        product_band: readinessBand(s.product ?? 0),
      };
    });
    const last = pageRows.at(-1);
    return send(reply, q.format, "readiness", data, { next_cursor: ids.length > q.limit && last ? encode(last.id) : null });
  });

  /** One row per placement registration, with the readiness and practice snapshot taken when the student registered. */
  api.get("/v1/reports/placements", scope, async (req, reply) => {
    const q = parse(page, req.query);
    const after = decode(q.cursor, 2);
    const rows = await db
      .select({ a: placementApplications, d: placementDrives, rollNo: users.rollNo })
      .from(placementApplications)
      .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
      .innerJoin(users, eq(users.id, placementApplications.userId))
      .where(
        and(
          eq(placementApplications.tenantId, req.api.tenantId),
          after ? or(gt(placementApplications.driveId, after[0]!), and(eq(placementApplications.driveId, after[0]!), gt(placementApplications.userId, after[1]!))) : undefined,
        ),
      )
      .orderBy(asc(placementApplications.driveId), asc(placementApplications.userId))
      .limit(q.limit + 1);
    const pageRows = rows.slice(0, q.limit);
    const data = pageRows.map(({ a, d, rollNo }) => ({
      drive_id: d.id,
      company: d.company,
      company_type: d.companyType,
      role: d.roleTitle,
      drive_date: d.driveDate,
      drive_ctc: d.ctcRupees,
      user_id: a.userId,
      roll_no: rollNo,
      status: a.status,
      rounds_cleared: a.roundsCleared,
      rounds_total: d.rounds.length,
      offer_ctc: a.offerCtcRupees,
      readiness_at_registration: a.readiness[d.companyType === "product" ? "product" : "service"] ?? null,
      practice_days_60_before: a.activeDays60,
      registered_at: a.createdAt,
    }));
    const last = pageRows.at(-1);
    return send(reply, q.format, "placements", data, { next_cursor: rows.length > q.limit && last ? encode(last.a.driveId, last.a.userId) : null });
  });

}
