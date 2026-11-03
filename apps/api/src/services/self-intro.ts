import { and, count, eq, gte } from "drizzle-orm";
import { INTRO_DRAFTS_PER_DAY, introPractice, introSeconds } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { aiUsage, selfIntros, type IntroPracticeStats } from "../db/schema";
import { aiProvider, AiUnavailableError } from "../lib/ai";
import { badRequest, HttpError } from "../lib/errors";
import { recordAiUsage } from "./coach";
import { aiAllowed } from "./plan";
import { resumeData } from "./resume";
import { getTenant } from "./tenant";

// "Tell me about yourself": the student's script, an AI draft from their own
// profile, and spoken run-throughs scored against the script without AI. Only
// counts and the latest and best scores of the run-throughs are kept, not what
// was said.

type Ctx = { tenantId: string; userId: string; now: Date };
const DAY = 86_400_000;
const EMPTY: IntroPracticeStats = { runs: 0, best: null, last: null };

async function row(db: DbOrTx, userId: string) {
  const [r] = await db.select().from(selfIntros).where(eq(selfIntros.userId, userId));
  return r ?? null;
}

async function draftsToday(db: DbOrTx, ctx: Ctx) {
  const [{ n }] = (await db
    .select({ n: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, ctx.userId), eq(aiUsage.feature, "intro_draft"), gte(aiUsage.createdAt, new Date(ctx.now.getTime() - DAY))))) as [{ n: number }];
  return n;
}

async function draftAvailability(db: DbOrTx, ctx: Ctx): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!aiProvider() || (await getTenant(db, ctx.tenantId)).settings.aiHints === false) return { ok: false, reason: "AI feedback is not switched on for your institution." };
  return aiAllowed(db, ctx.tenantId, "ai_coach", ctx.now);
}

const view = (r: Awaited<ReturnType<typeof row>>) => ({
  targetRole: r?.targetRole ?? "",
  extra: r?.extra ?? "",
  script: r?.script ?? "",
  seconds: introSeconds(r?.script ?? ""),
  draftedAt: r?.draftedAt ?? null,
  practice: r?.practice ?? EMPTY,
  updatedAt: r?.updatedAt ?? null,
});

export async function myIntro(db: Db, ctx: Ctx) {
  const allowed = await draftAvailability(db, ctx);
  const profile = await resumeData(db, ctx.userId, ctx.now);
  return {
    intro: view(await row(db, ctx.userId)),
    draft: { available: allowed.ok, reason: allowed.ok ? null : allowed.reason, leftToday: Math.max(0, INTRO_DRAFTS_PER_DAY - (await draftsToday(db, ctx))) },
    // What a draft would have to work with, so the student can add more first.
    profile: { projects: profile.projects.length, internships: profile.internships.length, certifications: profile.certifications.length, skills: profile.skills.length },
  };
}

async function upsert(db: DbOrTx, ctx: Ctx, set: Partial<typeof selfIntros.$inferInsert>) {
  await db
    .insert(selfIntros)
    .values({ userId: ctx.userId, tenantId: ctx.tenantId, ...set, updatedAt: ctx.now })
    .onConflictDoUpdate({ target: selfIntros.userId, set: { ...set, updatedAt: ctx.now } });
}

export async function saveIntro(db: Db, ctx: Ctx, input: { script: string; targetRole: string; extra: string }) {
  await upsert(db, ctx, input);
  return myIntro(db, ctx);
}

/** Draft a script from the student's profile. It replaces the saved script; the student edits from there. */
export async function draftIntro(db: Db, ctx: Ctx, input: { targetRole: string; extra: string }) {
  const allowed = await draftAvailability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  if ((await draftsToday(db, ctx)) >= INTRO_DRAFTS_PER_DAY) throw new HttpError(429, "intro_daily_limit", `You've had ${INTRO_DRAFTS_PER_DAY} drafts today. Edit this one, or try again tomorrow.`);
  const p = await resumeData(db, ctx.userId, ctx.now);
  let res;
  try {
    res = await aiProvider()!.introDraft({
      firstName: p.name.split(" ")[0]!,
      fullName: p.name,
      program: p.program,
      institution: p.institution,
      targetRole: input.targetRole,
      extra: input.extra,
      skills: p.skills.map((s) => s.name),
      projects: p.projects.map((x) => ({ title: x.title, description: x.description })),
      internships: p.internships.map((x) => ({ title: x.title, organisation: x.organisation, description: x.description })),
      certifications: p.certifications.map((c) => `${c.title} (${c.organisation})`),
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof AiUnavailableError) throw new HttpError(502, "intro_unavailable", err.message);
    throw new HttpError(503, "intro_unavailable", "The writer is busy right now. Try again in a moment.");
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "intro_draft", usage: res.usage, now: ctx.now });
  await upsert(db, ctx, { ...input, script: res.value.script.trim().slice(0, 3000), draftedAt: ctx.now });
  return { ...(await myIntro(db, ctx)), used: res.value.used.slice(0, 10) };
}

/** Score a spoken run-through against the saved script, and keep the counts. */
export async function practiseIntro(db: Db, ctx: Ctx, input: { heard: string; spokenMs: number; hidden: boolean }) {
  const r = await row(db, ctx.userId);
  if (!r?.script.trim()) throw badRequest("Save your introduction first");
  const result = introPractice(r.script, input.heard, input.spokenMs);
  const stats: IntroPracticeStats = {
    runs: r.practice.runs + 1,
    best: Math.max(r.practice.best ?? 0, result.coverage),
    last: { coverage: result.coverage, seconds: result.seconds, wpm: result.wpm, fillersPer100Words: result.fillersPer100Words, hidden: input.hidden, at: ctx.now.toISOString() },
  };
  await db.update(selfIntros).set({ practice: stats }).where(eq(selfIntros.userId, ctx.userId));
  return { result, practice: stats };
}

/** A student's introduction, for staff in scope (mentors, trainers). */
export async function introForStaff(db: Db, userId: string) {
  const r = await row(db, userId);
  return { intro: r && r.script.trim() ? view(r) : null };
}
