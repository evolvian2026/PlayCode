import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { requireFeature } from "../services/plan";
import { candidateProfile, companyInvites, institutionTalent, myTalent, respondToInvite, searchTalent, sendInvite, setDiscoverable, setInstitutionPool } from "../services/talent";

const idParam = z.object({ id: z.string().uuid() });

/** The talent pool: students opting in, companies searching and inviting, and the placement cell's view. */
export async function talentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const ctx = (req: { auth: { userId: string } } & Parameters<typeof tenantOf>[0]) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  // ---------- Students ----------
  app.register(async (s) => {
    s.addHook("preHandler", requirePermission("practice.play"));
    s.get("/student/talent", async (req) => myTalent(db, ctx(req)));
    s.put("/student/talent", async (req) => {
      const body = parse(
        z.object({
          discoverable: z.boolean(),
          lookingFor: z.object({ locations: z.array(z.string().max(60)).max(5).optional(), companyTypes: z.array(z.enum(["service", "product"])).max(2).optional() }).default({}),
        }),
        req.body,
      );
      return setDiscoverable(db, ctx(req), body);
    });
    s.post("/student/talent/invites/:id/accept", async (req) => respondToInvite(db, ctx(req), parse(idParam, req.params).id, true));
    s.post("/student/talent/invites/:id/decline", async (req) => respondToInvite(db, ctx(req), parse(idParam, req.params).id, false));
  });

  // ---------- Companies ----------
  app.register(async (c) => {
    c.addHook("preHandler", requirePermission("drives.manage"));
    c.addHook("preHandler", requireFeature("talent_search"));
    c.get("/console/talent/search", async (req) => {
      const q = parse(
        z.object({
          track: z.enum(["service", "product"]).default("service"),
          minReadiness: z.coerce.number().int().min(0).max(100).default(0),
          graduationYear: z.coerce.number().int().min(2000).max(2100).optional(),
          skills: z
            .string()
            .max(500)
            .optional()
            .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : [])),
          location: z.string().max(60).optional(),
          cursor: z.coerce.number().int().min(0).optional(),
        }),
        req.query,
      );
      return searchTalent(db, ctx(req), q);
    });
    c.get("/console/talent/candidates/:id", async (req) => candidateProfile(db, ctx(req), parse(idParam, req.params).id));
    c.get("/console/talent/invites", async (req) => companyInvites(db, ctx(req)));
    c.post("/console/talent/invites", async (req) => {
      const body = parse(
        z.object({
          userId: z.string().uuid(),
          roleTitle: z.string().trim().min(2).max(120),
          message: z.string().trim().min(10, "Write a short message: what the role is and why them").max(1000),
          driveId: z.string().uuid().nullable().default(null),
        }),
        req.body,
      );
      const invite = await sendInvite(db, ctx(req), body);
      return { id: invite.id };
    });
  });

  // ---------- Institutions ----------
  app.register(async (i) => {
    i.addHook("preHandler", requirePermission("placements.manage"));
    i.get("/console/talent/institution", async (req) => institutionTalent(db, tenantOf(req), app.now()));
    i.put("/console/talent/institution", async (req) => {
      const { open } = parse(z.object({ open: z.boolean() }), req.body);
      return setInstitutionPool(db, { tenantId: tenantOf(req), actorId: req.auth.userId, open });
    });
  });
}
