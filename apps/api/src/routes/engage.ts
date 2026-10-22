import { desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { competitions, notifications, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, forbidden } from "../lib/errors";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { competitionState, getCompetition, leaderboard, studentCompetitions, tenantCompetitions, unitNames } from "../services/competitions";
import { inbox, markRead, processOutbox, whatsappConfigured } from "../services/notifications";
import { audienceIds, runNudges, sendAnnouncement } from "../services/nudges";
import { recordConsent } from "../services/privacy";
import { assertUnitsInScope, scopedUnitIds } from "../services/scope";
import { getTenant, tenantToday } from "../services/tenant";

const timeWindow = z.object({ startsAt: z.coerce.date(), endsAt: z.coerce.date() }).refine((w) => w.endsAt > w.startsAt, { message: "End must be after start" });

/** Events, nudges and notifications: console, student and admin routes. */
export async function engageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ---------- Console: events ----------
  const staff = requireAny("analytics.institution", "analytics.department", "analytics.own_units");

  app.get("/console/competitions", { preHandler: staff }, async (req) => {
    const tenantId = tenantOf(req);
    const now = app.now();
    const rows = await tenantCompetitions(db, tenantId);
    const names = await unitNames(db, rows.flatMap((r) => (r.scope === "sections" ? r.teamIds : [])));
    return {
      events: await Promise.all(
        rows.map(async (c) => ({
          id: c.id,
          title: c.title,
          description: c.description,
          scope: c.scope,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          state: competitionState(c, now),
          teams: c.scope === "sections" ? c.teamIds.map((id) => names.get(id) ?? "Unknown") : [],
          leaderboard: await leaderboard(db, c, now),
        })),
      ),
    };
  });

  app.post("/console/competitions", { preHandler: requirePermission("events.manage") }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z.object({ title: z.string().min(1).max(120), description: z.string().max(1000).default(""), unitIds: z.array(z.string().uuid()).min(2).max(50) }).and(timeWindow),
      req.body,
    );
    await assertUnitsInScope(db, req.auth, body.unitIds);
    const [created] = await db
      .insert(competitions)
      .values({ tenantId, title: body.title, description: body.description, scope: "sections", teamIds: body.unitIds, startsAt: body.startsAt, endsAt: body.endsAt, createdBy: req.auth.userId })
      .returning();
    await audit(db, { tenantId, actorId: req.auth.userId, action: "event.create", target: created!.id, data: { title: body.title } });
    return { event: created };
  });

  app.get("/console/competitions/:id", { preHandler: staff }, async (req) => {
    const tenantId = tenantOf(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const c = await getCompetition(db, tenantId, id);
    return { event: { ...c, state: competitionState(c, app.now()) }, leaderboard: await leaderboard(db, c, app.now()) };
  });

  // ---------- Console: nudges ----------
  const audienceSchema = z.object({
    unitId: z.string().uuid().optional(),
    audience: z.enum(["all", "inactive_7d", "at_risk", "assignment_pending"]),
    assignmentId: z.string().uuid().optional(),
  });

  async function resolveAudience(req: Parameters<typeof tenantOf>[0], body: z.infer<typeof audienceSchema>) {
    const tenantId = tenantOf(req);
    const scoped = await scopedUnitIds(db, req.auth);
    if (body.unitId && !scoped.includes(body.unitId)) throw forbidden("That batch or section is outside your scope");
    if (body.audience === "assignment_pending" && !body.assignmentId) throw badRequest("Choose the assignment");
    const tenant = await getTenant(db, tenantId);
    const now = app.now();
    return audienceIds(db, { tenantId, unitIds: body.unitId ? [body.unitId] : scoped, audience: body.audience, assignmentId: body.assignmentId, now, today: tenantToday(tenant, now) });
  }

  app.post("/console/nudges/preview", { preHandler: requirePermission("nudges.send") }, async (req) => {
    const ids = await resolveAudience(req, parse(audienceSchema, req.body));
    return { count: ids.length, whatsapp: whatsappConfigured() };
  });

  app.post("/console/nudges", { preHandler: requirePermission("nudges.send") }, async (req) => {
    const body = parse(audienceSchema.and(z.object({ title: z.string().min(1).max(80), message: z.string().min(1).max(500) })), req.body);
    const tenantId = tenantOf(req);
    const ids = await resolveAudience(req, body);
    if (ids.length === 0) throw badRequest("No students match that audience");
    const sent = await sendAnnouncement(db, { tenantId, actorId: req.auth.userId, userIds: ids, title: body.title, message: body.message });
    await audit(db, { tenantId, actorId: req.auth.userId, action: "nudge.send", data: { audience: body.audience, count: sent } });
    void processOutbox(db, app.now()).catch((err) => req.log.error(err));
    return { sent };
  });

  app.get("/console/nudges", { preHandler: requirePermission("nudges.send") }, async (req) => {
    const tenantId = tenantOf(req);
    const rows = await db
      .select({
        title: notifications.title,
        template: notifications.template,
        day: sql<string>`to_char(${notifications.createdAt}, 'YYYY-MM-DD')`,
        sentBy: users.name,
        total: sql<number>`count(*)::int`,
        whatsapp: sql<number>`sum(case when ${notifications.status} = 'sent' then 1 else 0 end)::int`,
        read: sql<number>`sum(case when ${notifications.readAt} is not null then 1 else 0 end)::int`,
      })
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.sentBy))
      .where(eq(notifications.tenantId, tenantId))
      .groupBy(notifications.title, notifications.template, sql`3`, users.name)
      .orderBy(desc(sql`3`))
      .limit(50);
    const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    return { history: rows, automaticNudges: tenant?.settings.nudges !== false, whatsapp: whatsappConfigured() };
  });

  app.put("/console/settings/nudges", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const tenantId = tenantOf(req);
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    await db
      .update(tenants)
      .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ nudges: enabled })}::jsonb` })
      .where(eq(tenants.id, tenantId));
    await audit(db, { tenantId, actorId: req.auth.userId, action: "settings.nudges", data: { enabled } });
    return { enabled };
  });

  // ---------- Student ----------
  app.get("/student/competitions", { preHandler: requirePermission("practice.play") }, async (req) => ({
    events: await studentCompetitions(db, { userId: req.auth.userId, tenantId: tenantOf(req), now: app.now() }),
  }));
  app.get("/student/notifications", { preHandler: requirePermission("practice.play") }, async (req) => inbox(db, req.auth.userId));
  app.post("/student/notifications/read", { preHandler: requirePermission("practice.play") }, async (req) => markRead(db, req.auth.userId, app.now()));
  app.get("/student/settings", { preHandler: requirePermission("practice.play") }, async (req) => {
    const [u] = await db.select({ phone: users.phone, prefs: users.notifyPrefs }).from(users).where(eq(users.id, req.auth.userId));
    return { phone: u?.phone ?? null, whatsapp: u?.prefs.whatsapp !== false };
  });
  app.put("/student/settings", { preHandler: requirePermission("practice.play") }, async (req) => {
    const body = parse(z.object({ phone: z.string().regex(/^\+?\d[\d\s-]{8,16}$/).nullable().optional(), whatsapp: z.boolean().optional() }), req.body);
    const set: Partial<typeof users.$inferInsert> = {};
    if (body.phone !== undefined) set.phone = body.phone ? body.phone.replace(/[^\d+]/g, "") : null;
    if (body.whatsapp !== undefined) set.notifyPrefs = { whatsapp: body.whatsapp };
    if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, req.auth.userId));
    if (body.whatsapp !== undefined) await recordConsent(db, { tenantId: req.auth.tenantId, userId: req.auth.userId, purpose: "whatsapp", granted: body.whatsapp, source: "settings", now: app.now() });
    const [u] = await db.select({ phone: users.phone, prefs: users.notifyPrefs }).from(users).where(eq(users.id, req.auth.userId));
    return { phone: u?.phone ?? null, whatsapp: u?.prefs.whatsapp !== false };
  });

  // ---------- Admin ----------
  app.post("/admin/competitions", { preHandler: requirePermission("tenants.manage") }, async (req) => {
    if (!req.auth.roles.includes("super_admin")) throw forbidden("Only PlayCode admins run inter-college events");
    const body = parse(z.object({ title: z.string().min(1).max(120), description: z.string().max(1000).default(""), tenantIds: z.array(z.string().uuid()).min(2).max(200) }).and(timeWindow), req.body);
    const [created] = await db
      .insert(competitions)
      .values({ tenantId: null, title: body.title, description: body.description, scope: "colleges", teamIds: body.tenantIds, startsAt: body.startsAt, endsAt: body.endsAt, createdBy: req.auth.userId })
      .returning();
    return { event: created };
  });

  /** Hourly job: queue automatic nudges and deliver the outbox. */
  app.post("/admin/nudges/run", { preHandler: requirePermission("nudges.send") }, async (req) => {
    const body = parse(z.object({ ignoreQuietHours: z.boolean().optional() }), req.body ?? {});
    const isSuper = req.auth.roles.includes("super_admin");
    const queued = await runNudges(db, app.now(), { tenantId: isSuper ? undefined : tenantOf(req), ignoreQuietHours: body.ignoreQuietHours });
    const delivered = await processOutbox(db, app.now());
    return { queued, delivered };
  });
}
