import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { badRequest, notFound } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { calendarEvents, feedIcs, feedStatus, resetFeed, revokeFeed } from "../services/calendar";

const DAY = 86_400_000;

/** The student's calendar, and the private link a calendar app subscribes to. */
export async function calendarStudentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/calendar", async (req) => {
    const now = app.now();
    const { from, to } = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
    const start = from ?? new Date(now.getTime() - 7 * DAY);
    const end = to ?? new Date(now.getTime() + 60 * DAY);
    if (end <= start || end.getTime() - start.getTime() > 200 * DAY) throw badRequest("Ask for up to 200 days at a time");
    return { events: await calendarEvents(db, ctx(req), start, end), feed: await feedStatus(db, req.auth.userId) };
  });
  app.post("/student/calendar/feed", async (req) => resetFeed(db, req.auth.userId, app.now()));
  app.delete("/student/calendar/feed", async (req) => {
    await revokeFeed(db, req.auth.userId);
    return { ok: true };
  });
}

/** The feed itself: no sign-in, the token in the link is the key. */
export async function calendarFeedRoutes(app: FastifyInstance) {
  app.get("/calendar/:file", async (req, reply) => {
    const { file } = parse(z.object({ file: z.string().max(80) }), req.params);
    if (!file.endsWith(".ics")) throw notFound("Calendar");
    const ics = await feedIcs(db, file.slice(0, -4), app.now());
    return reply.header("content-type", "text/calendar; charset=utf-8").header("cache-control", "private, max-age=300").send(ics);
  });
}
