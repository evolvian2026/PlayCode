import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { apiClients, assessmentAttempts, assessments, assignments, memberships, orgUnits, sessions, users, type ApiScope } from "../db/schema";
import { API_TOKEN_TTL_S, signApiToken, verifyApiToken } from "../lib/auth";
import { safeEqual, sha256 } from "../lib/crypto";
import { forbidden, HttpError, notFound, unauthorized } from "../lib/errors";
import { parse } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { readinessFor, studentDetail } from "../services/analytics";
import { createAssignment } from "../services/assignments";
import { sessionScore } from "../services/practice";
import { descendants, studentIdsInUnits, tenantUnits } from "../services/scope";
import { importStudents } from "../services/students";
import { getTenant, streakRules, tenantToday } from "../services/tenant";
import { hasFeature } from "../services/plan";
import { reportRoutes } from "./v1-reports";
import { assertWritable } from "../services/licence";

// Public REST API for ERPs, LMSs and ATSs. Clients use OAuth 2.0 client
// credentials: POST /v1/oauth/token, then send "Authorization: Bearer <token>".
// Lists use cursor pagination: ?limit=100&cursor=<next_cursor from the last page>.

declare module "fastify" {
  interface FastifyRequest {
    api: { clientId: string; tenantId: string; scopes: string[] };
  }
}

function requireScope(scope: ApiScope) {
  return async (req: FastifyRequest) => {
    if (!req.api.scopes.includes(scope)) throw forbidden(`This client needs the ${scope} scope`);
  };
}

const page = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().optional() });

/** Opaque cursor over (createdAt, id). */
const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decodeCursor(cursor?: string): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || Number.isNaN(d.getTime())) throw new HttpError(400, "bad_cursor", "Invalid cursor");
  return { at: d, id };
}

export async function v1Routes(app: FastifyInstance) {
  app.post("/v1/oauth/token", async (req, reply) => {
    // Credentials in the body (form or JSON) or as HTTP Basic auth.
    let body = (req.body ?? {}) as Record<string, string>;
    const basic = req.headers.authorization?.match(/^Basic (.+)$/);
    if (basic) {
      const [id, secret] = Buffer.from(basic[1]!, "base64").toString().split(":");
      body = { ...body, client_id: id ?? "", client_secret: secret ?? "" };
    }
    const { grant_type, client_id, client_secret } = parse(
      z.object({ grant_type: z.literal("client_credentials"), client_id: z.string().min(1).max(100), client_secret: z.string().min(1).max(200) }),
      body,
    );
    void grant_type;
    await rateLimit(`token:${client_id}`, 60, 60_000);
    const [client] = await db.select().from(apiClients).where(eq(apiClients.clientId, client_id));
    if (!client || client.revokedAt || !safeEqual(client.secretHash, sha256(client_secret))) {
      return reply.status(401).send({ error: "invalid_client" });
    }
    if (!(await hasFeature(db, client.tenantId, "api"))) {
      return reply.status(403).send({ error: "unauthorized_client", error_description: "The public API is not included in this institution's plan" });
    }
    await db.update(apiClients).set({ lastUsedAt: app.now() }).where(eq(apiClients.id, client.id));
    const token = await signApiToken({ clientId: client.id, tenantId: client.tenantId, scopes: client.scopes });
    return { access_token: token, token_type: "Bearer", expires_in: API_TOKEN_TTL_S, scope: client.scopes.join(" ") };
  });

  // Content type for form-encoded token requests.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  app.register(async (api) => {
    api.addHook("preHandler", async (req) => {
      if (req.url.startsWith("/v1/oauth/")) return;
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) throw unauthorized("Send an access token from /v1/oauth/token");
      try {
        req.api = await verifyApiToken(header.slice(7));
      } catch {
        throw unauthorized("The access token is invalid or expired");
      }
      const [client] = await db.select({ revokedAt: apiClients.revokedAt }).from(apiClients).where(eq(apiClients.id, req.api.clientId));
      if (!client || client.revokedAt) throw unauthorized("This API client has been revoked");
      await assertWritable(db, { tenantId: req.api.tenantId, method: req.method, url: req.url, superAdmin: false, now: app.now() });
    });

    reportRoutes(api, requireScope);

    api.get("/v1/org-units", { preHandler: requireScope("users:read") }, async (req) => ({
      data: (await tenantUnits(db, req.api.tenantId)).map((u) => ({ id: u.id, name: u.name, kind: u.kind, parent_id: u.parentId })),
    }));

    api.get("/v1/users", { preHandler: requireScope("users:read") }, async (req) => {
      const q = parse(page.extend({ role: z.enum(["student", "staff"]).default("student") }), req.query);
      const after = decodeCursor(q.cursor);
      // Postgres keeps microseconds but cursors carry milliseconds, so compare at millisecond precision.
      const createdMs = sql`date_trunc('milliseconds', ${users.createdAt})`;
      const rows = await db
        .select({ user: users })
        .from(users)
        .where(
          and(
            eq(users.tenantId, req.api.tenantId),
            sql`exists (select 1 from ${memberships} m where m.user_id = ${users.id} and ${q.role === "student" ? sql`m.role = 'student'` : sql`m.role <> 'student'`})`,
            after ? sql`(${createdMs}, ${users.id}) > (${after.at}, ${after.id})` : undefined,
          ),
        )
        .orderBy(asc(createdMs), asc(users.id))
        .limit(q.limit + 1);
      const pageRows = rows.slice(0, q.limit);
      const units = pageRows.length
        ? await db.select({ userId: memberships.userId, unitId: memberships.orgUnitId, role: memberships.role }).from(memberships).where(inArray(memberships.userId, pageRows.map((r) => r.user.id)))
        : [];
      const last = pageRows.at(-1)?.user;
      return {
        data: pageRows.map(({ user: u }) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          roll_no: u.rollNo,
          status: u.status,
          roles: [...new Set(units.filter((m) => m.userId === u.id).map((m) => m.role))],
          unit_ids: units.filter((m) => m.userId === u.id && m.unitId).map((m) => m.unitId),
          created_at: u.createdAt,
        })),
        next_cursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    });

    api.post("/v1/users", { preHandler: requireScope("users:write") }, async (req) => {
      const body = parse(
        z.object({
          unit_id: z.string().uuid(),
          students: z.array(z.object({ name: z.string().min(1).max(120), email: z.string().email(), roll_no: z.string().max(40).optional(), phone: z.string().max(20).optional() })).min(1).max(1000),
          default_password: z.string().min(8).max(100).optional(),
        }),
        req.body,
      );
      const units = await tenantUnits(db, req.api.tenantId);
      if (!units.some((u) => u.id === body.unit_id)) throw notFound("Org unit");
      const [client] = await db.select().from(apiClients).where(eq(apiClients.id, req.api.clientId));
      const result = await importStudents(db, {
        tenantId: req.api.tenantId,
        actorId: client!.createdBy,
        unitId: body.unit_id,
        rows: body.students.map((s) => ({ name: s.name, email: s.email, rollNo: s.roll_no ?? null, phone: s.phone ?? null })),
        defaultPassword: body.default_password,
        now: app.now(),
      });
      return { created: result.created.map((c) => ({ id: c.id, email: c.email, password: c.password })), skipped: result.skipped };
    });

    api.patch("/v1/users/:id", { preHandler: requireScope("users:write") }, async (req) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const body = parse(z.object({ status: z.enum(["active", "disabled"]) }), req.body);
      const [u] = await db.update(users).set({ status: body.status }).where(and(eq(users.id, id), eq(users.tenantId, req.api.tenantId))).returning({ id: users.id, status: users.status });
      if (!u) throw notFound("User");
      return { data: u };
    });

    api.get("/v1/students/:id", { preHandler: requireScope("results:read") }, async (req) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.tenantId, req.api.tenantId)));
      if (!u) throw notFound("Student");
      const tenant = await getTenant(db, req.api.tenantId);
      return { data: await studentDetail(db, { userId: id, today: tenantToday(tenant, app.now()), rules: streakRules(tenant) }) };
    });

    api.get("/v1/readiness", { preHandler: requireScope("results:read") }, async (req) => {
      const q = parse(z.object({ unit_id: z.string().uuid().optional() }), req.query);
      const units = await tenantUnits(db, req.api.tenantId);
      const ids = await studentIdsInUnits(db, req.api.tenantId, q.unit_id ? descendants(units, [q.unit_id]) : units.map((u) => u.id));
      const tenant = await getTenant(db, req.api.tenantId);
      const scores = await readinessFor(db, ids, tenantToday(tenant, app.now()));
      return { data: ids.map((id) => ({ user_id: id, ...scores.get(id) })) };
    });

    api.get("/v1/assignments", { preHandler: requireScope("assignments:read") }, async (req) => {
      const rows = await db.select().from(assignments).where(eq(assignments.tenantId, req.api.tenantId)).orderBy(desc(assignments.createdAt)).limit(200);
      return { data: rows.map((a) => ({ id: a.id, title: a.title, pack_id: a.packId, question_count: a.questionIds.length, unit_ids: a.orgUnitIds, student_ids: a.studentIds, open_at: a.openAt, close_at: a.closeAt })) };
    });

    api.post("/v1/assignments", { preHandler: requireScope("assignments:write") }, async (req) => {
      const body = parse(
        z
          .object({
            title: z.string().min(1).max(120),
            pack_id: z.string().optional(),
            skill_ids: z.array(z.string()).max(20).optional(),
            count: z.number().int().min(1).max(50).default(10),
            unit_ids: z.array(z.string().uuid()).min(1),
            open_at: z.coerce.date(),
            close_at: z.coerce.date(),
          })
          .refine((b) => Boolean(b.pack_id) !== Boolean(b.skill_ids?.length), { message: "Send either pack_id or skill_ids" })
          .refine((b) => b.close_at > b.open_at, { message: "close_at must be after open_at" }),
        req.body,
      );
      const units = new Set((await tenantUnits(db, req.api.tenantId)).map((u) => u.id));
      if (body.unit_ids.some((u) => !units.has(u))) throw notFound("Org unit");
      const [client] = await db.select().from(apiClients).where(eq(apiClients.id, req.api.clientId));
      const a = await createAssignment(db, {
        tenantId: req.api.tenantId,
        actorId: client!.createdBy,
        title: body.title,
        packId: body.pack_id,
        skillIds: body.skill_ids,
        count: body.count,
        unitIds: body.unit_ids,
        openAt: body.open_at,
        closeAt: body.close_at,
      });
      return { data: { id: a.id, title: a.title, question_count: a.questionIds.length } };
    });

    /** Results feed: finished assignment sessions and submitted tests, oldest first, for syncing to an ERP or gradebook. */
    api.get("/v1/results", { preHandler: requireScope("results:read") }, async (req) => {
      const q = parse(z.object({ since: z.coerce.date().default(new Date(0)), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
      const done = await db
        .select({ s: sessions, title: assignments.title })
        .from(sessions)
        .innerJoin(assignments, eq(assignments.id, sessions.assignmentId))
        .where(and(eq(sessions.tenantId, req.api.tenantId), isNotNull(sessions.finishedAt), gt(sessions.finishedAt, q.since)))
        .orderBy(asc(sessions.finishedAt))
        .limit(q.limit);
      const tests = await db
        .select({ a: assessmentAttempts, title: assessments.title, released: assessments.resultsReleasedAt, policy: assessments.releasePolicy })
        .from(assessmentAttempts)
        .innerJoin(assessments, eq(assessments.id, assessmentAttempts.assessmentId))
        .where(and(eq(assessmentAttempts.tenantId, req.api.tenantId), isNotNull(assessmentAttempts.submittedAt), gt(assessmentAttempts.submittedAt, q.since)))
        .orderBy(asc(assessmentAttempts.submittedAt))
        .limit(q.limit);
      const items = [
        ...done.map(({ s, title }) => ({ type: "assignment", id: s.id, assignment_id: s.assignmentId, title, user_id: s.userId, score_pct: sessionScore(s), completed_at: s.finishedAt! })),
        ...tests.map(({ a, title, released, policy }) => ({
          type: "assessment",
          id: a.id,
          assessment_id: a.assessmentId,
          title,
          user_id: a.userId,
          score: a.score !== null ? a.score / 100 : null,
          max_score: a.maxScore !== null ? a.maxScore / 100 : null,
          released: policy === "immediate" || released !== null,
          risk_score: a.riskScore,
          completed_at: a.submittedAt!,
        })),
      ].sort((x, y) => x.completed_at.getTime() - y.completed_at.getTime());
      const last = items.at(-1);
      return { data: items.slice(0, q.limit), next_since: last ? last.completed_at.toISOString() : null };
    });

    api.get("/v1/org-units/:id/students", { preHandler: requireScope("users:read") }, async (req) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const units = await tenantUnits(db, req.api.tenantId);
      if (!units.some((u) => u.id === id)) throw notFound("Org unit");
      const ids = await studentIdsInUnits(db, req.api.tenantId, descendants(units, [id]));
      const rows = ids.length ? await db.select({ id: users.id, name: users.name, email: users.email, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)) : [];
      const name = (await db.select({ name: orgUnits.name }).from(orgUnits).where(eq(orgUnits.id, id)))[0]?.name;
      return { unit: { id, name }, data: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, roll_no: r.rollNo })) };
    });
  });
}
