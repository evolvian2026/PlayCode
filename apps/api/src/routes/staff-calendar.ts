import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { badRequest } from "../lib/errors";
import { authenticate, parse, requireAny, tenantOf } from "../lib/http";
import { staffCalendar } from "../services/staff-calendar";

const DAY = 86_400_000;

/** The console calendar (under /console). */
export async function staffCalendarRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAny("placements.manage", "assignments.manage"));
  app.get("/calendar", async (req) => {
    const now = app.now();
    const { from, to } = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
    const start = from ?? new Date(now.getTime() - 7 * DAY);
    const end = to ?? new Date(now.getTime() + 35 * DAY);
    if (end <= start || end.getTime() - start.getTime() > 120 * DAY) throw badRequest("Ask for up to 120 days at a time");
    return { events: await staffCalendar(db, { ...req.auth, tenantId: tenantOf(req) }, start, end, now) };
  });
}
