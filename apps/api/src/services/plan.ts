import { and, eq, gte, sql } from "drizzle-orm";
import { FEATURE_LABELS, PLAN_SPECS, planFor, planHas, type Feature, type Plan } from "@playcode/core";
import type { FastifyRequest } from "fastify";
import { db as defaultDb, type DbOrTx } from "../db/client";
import { aiUsage, tenants } from "../db/schema";
import { HttpError } from "../lib/errors";
import { tenantOf } from "../lib/http";

// What a tenant's plan allows. Checks sit at each feature's entry point
// (configuring it, starting it); data created on a higher plan stays readable
// after a downgrade.

export async function tenantPlan(db: DbOrTx, tenantId: string): Promise<Plan> {
  const [t] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.plan ?? "starter";
}

export async function hasFeature(db: DbOrTx, tenantId: string, feature: Feature): Promise<boolean> {
  return planHas(await tenantPlan(db, tenantId), feature);
}

export class PlanError extends HttpError {
  constructor(feature: Feature) {
    super(402, "plan_upgrade", `${FEATURE_LABELS[feature]} is part of the ${PLAN_SPECS[planFor(feature)].name} plan. Ask PlayCode to upgrade your plan.`);
  }
}

export async function assertFeature(db: DbOrTx, tenantId: string, feature: Feature): Promise<void> {
  if (!(await hasFeature(db, tenantId, feature))) throw new PlanError(feature);
}

/** Route guard: the signed-in user's institution must have the feature. */
export const requireFeature = (feature: Feature) => async (req: FastifyRequest) => assertFeature(defaultDb, tenantOf(req), feature);

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** AI tokens (input + output) a tenant has used this calendar month. */
export async function aiTokensThisMonth(db: DbOrTx, tenantId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint` })
    .from(aiUsage)
    .where(and(eq(aiUsage.tenantId, tenantId), gte(aiUsage.createdAt, monthStart(now))));
  return Number(row?.n ?? 0);
}

/**
 * Whether the tenant may make another AI call: the plan includes the feature,
 * and either it is within this month's allowance or the plan bills overage.
 */
export async function aiAllowed(db: DbOrTx, tenantId: string, feature: Feature, now: Date): Promise<{ ok: true } | { ok: false; reason: string }> {
  const plan = await tenantPlan(db, tenantId);
  if (!planHas(plan, feature)) return { ok: false, reason: new PlanError(feature).message };
  const spec = PLAN_SPECS[plan];
  if (spec.aiOveragePerMillionPaise > 0) return { ok: true };
  if ((await aiTokensThisMonth(db, tenantId, now)) >= spec.aiTokensPerMonth) {
    return { ok: false, reason: "Your institution has used this month's AI allowance. It renews on the 1st." };
  }
  return { ok: true };
}
