import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { badRequest } from "../lib/errors";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { requireFeature } from "../services/plan";
import { brochureData, brochurePdf, brochureSettings, setBrochureSettings } from "../services/brochure";
import { graduationYears } from "../services/graduate-outcomes";
import {
  addContact,
  completeFollowUp,
  createRecruiter,
  deleteRecruiter,
  importFromDrives,
  listRecruiters,
  logInteraction,
  recruiterDetail,
  removeContact,
  updateRecruiter,
} from "../services/recruiters";
import { seasonDashboard, seasonTargets, setSeasonTargets } from "../services/season";

const idParam = z.object({ id: z.string().uuid() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04");
const stage = z.enum(["prospect", "in_talks", "confirmed", "visited", "not_interested"]);
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);

/** Company relations, the placement brochure and season targets (under /console). */
export async function recruiterRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const manage = [requirePermission("placements.manage"), requireFeature("placements")];
  const reporting = [requireAny("placements.manage", "analytics.institution", "analytics.department"), requireFeature("placements")];
  const auth = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId });
  const staffAuth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });

  const recruiter = z.object({
    name: z.string().trim().min(2, "Enter the company's name").max(120),
    sector: z.string().trim().max(80).default(""),
    website: optional(200).refine((v) => !v || /^https?:\/\//.test(v), "Start the website with https://"),
    stage: stage.default("prospect"),
    notes: z.string().trim().max(4000).default(""),
    ownerId: z.string().uuid().nullable().default(null),
  });

  app.get("/recruiters", { preHandler: manage }, async (req) => listRecruiters(db, auth(req), app.now()));
  app.post("/recruiters", { preHandler: manage }, async (req) => createRecruiter(db, auth(req), parse(recruiter, req.body), app.now()));
  app.post("/recruiters/import", { preHandler: manage }, async (req) => importFromDrives(db, auth(req), app.now()));
  app.get("/recruiters/:id", { preHandler: manage }, async (req) => recruiterDetail(db, auth(req), parse(idParam, req.params).id, app.now()));
  app.put("/recruiters/:id", { preHandler: manage }, async (req) => updateRecruiter(db, auth(req), parse(idParam, req.params).id, parse(recruiter, req.body), app.now()));
  app.delete("/recruiters/:id", { preHandler: manage }, async (req) => deleteRecruiter(db, auth(req), parse(idParam, req.params).id));
  app.post("/recruiters/:id/contacts", { preHandler: manage }, async (req) => {
    const input = parse(
      z.object({
        name: z.string().trim().min(2, "Enter their name").max(120),
        designation: z.string().trim().max(120).default(""),
        email: optional(200).refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email"),
        phone: optional(20).refine((v) => !v || /^\+?[0-9 -]{7,20}$/.test(v), "Enter a valid phone number"),
      }),
      req.body,
    );
    return addContact(db, auth(req), parse(idParam, req.params).id, input, app.now());
  });
  app.delete("/recruiters/:id/contacts/:contactId", { preHandler: manage }, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }), req.params);
    return removeContact(db, auth(req), p.id, p.contactId, app.now());
  });
  app.post("/recruiters/:id/interactions", { preHandler: manage }, async (req) => {
    const input = parse(
      z.object({
        kind: z.enum(["call", "email", "meeting", "visit", "other"]),
        on: day,
        note: z.string().trim().min(2, "Say what was discussed").max(2000),
        followUpOn: day.nullable().default(null),
        stage: stage.nullable().default(null),
      }),
      req.body,
    );
    return logInteraction(db, auth(req), parse(idParam, req.params).id, input, app.now());
  });
  app.post("/recruiters/:id/interactions/:interactionId/done", { preHandler: manage }, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), interactionId: z.string().uuid() }), req.params);
    return completeFollowUp(db, auth(req), p.id, p.interactionId, app.now());
  });

  // ---------- Placement brochure ----------
  const text = (max: number) => z.string().trim().max(max).default("");
  app.get("/placements/brochure/settings", { preHandler: manage }, async (req) => ({ settings: await brochureSettings(db, tenantOf(req)), years: await graduationYears(db, tenantOf(req)) }));
  app.put("/placements/brochure/settings", { preHandler: manage }, async (req) => {
    const input = parse(
      z.object({
        about: text(3000),
        contactName: text(120),
        contactRole: text(120),
        contactEmail: text(200).refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email"),
        contactPhone: text(20),
      }),
      req.body,
    );
    return setBrochureSettings(db, auth(req), input);
  });
  app.get("/placements/brochure", { preHandler: manage }, async (req, reply) => {
    const year = parse(yearQuery, req.query).year ?? (await graduationYears(db, tenantOf(req)))[0];
    if (!year) throw badRequest("No graduating year is on record yet");
    const pdf = await brochurePdf(await brochureData(db, staffAuth(req), year, app.now()));
    reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename="placement-brochure-${year}.pdf"`);
    return reply.send(pdf);
  });

  // ---------- Season targets ----------
  const pickYear = async (req: FastifyRequest) => {
    const years = await graduationYears(db, tenantOf(req));
    return { years, year: parse(yearQuery, req.query).year ?? years[0] ?? null };
  };
  app.get("/placements/season", { preHandler: reporting }, async (req) => {
    const { years, year } = await pickYear(req);
    return { years, season: year ? await seasonDashboard(db, staffAuth(req), year) : null };
  });
  app.get("/placements/targets", { preHandler: manage }, async (req) => {
    const { years, year } = await pickYear(req);
    if (!year) throw badRequest("No graduating year is on record yet");
    return { years, year, ...(await seasonTargets(db, tenantOf(req), year)) };
  });
  app.put("/placements/targets", { preHandler: manage }, async (req) => {
    const pct = z.number().int().min(1).max(100).nullable();
    const input = parse(z.object({ year: z.number().int().min(2000).max(2100), institution: pct, departments: z.array(z.object({ unitId: z.string().uuid(), targetPct: pct })).max(100) }), req.body);
    return { year: input.year, ...(await setSeasonTargets(db, auth(req), input.year, input, app.now())) };
  });
}
