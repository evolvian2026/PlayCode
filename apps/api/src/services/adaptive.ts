import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, isNotNull, lte } from "drizzle-orm";
import {
  ADAPTIVE_SECTIONS,
  APTITUDE_TEMPLATES,
  estimateAbility,
  generateQuestion,
  nextLevel,
  nextTemplate,
  OFFICIAL_SCORE_MONTHS,
  scaledScore,
  SCORE_BANDS,
  scoreBand,
} from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { adaptiveAttempts, aptitudeSittings, memberships, users, type AdaptiveItem, type AdaptiveSectionState } from "../db/schema";
import { badRequest, conflict, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { appLink, enqueue, processOutbox } from "./notifications";
import { descendants, scopedUnitIds, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits, type AuthContext } from "./scope";

// The adaptive aptitude test, and drills on the same generated questions.
// Practice attempts are unlimited; an official attempt is taken once, in a
// sitting the placement cell opens, and its score is the one that goes on
// the resume and that drives can ask for.
// Each section pitches the next question at the current estimate of
// ability; the score is that estimate on a 100 to 900 scale. Questions a
// student doesn't reach before time runs out count as wrong, so leaving a
// section doesn't protect a score. Like mock tests, it measures rather than
// trains: it doesn't change mastery or XP.

type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof adaptiveAttempts.$inferSelect;
const MIN_FOR_PERCENTILE = 20;
/** An attempt left with a section's time run out this long is finished for the student. */
const ABANDONED_MS = 24 * 3_600_000;

const newSeed = () => randomBytes(4).readUInt32BE(0) >>> 1;
const spec = (key: string) => ADAPTIVE_SECTIONS.find((s) => s.key === key)!;

function ask(section: AdaptiveSectionState, now: Date) {
  const template = nextTemplate(section.key, section.items.map((i) => i.template), Math.random);
  const q = generateQuestion(template, nextLevel(section.theta), newSeed());
  const item: AdaptiveItem = { ...q, chosen: null, correct: null, askedAt: now.toISOString(), answeredAt: null };
  section.items.push(item);
}

function begin(section: AdaptiveSectionState, now: Date) {
  section.startedAt = now.toISOString();
  section.deadline = new Date(now.getTime() + spec(section.key).minutes * 60_000).toISOString();
  ask(section, now);
}

/** The answers that count: those given, then every question not reached (or left open when time ran out) as wrong at the last level. */
function counted(section: AdaptiveSectionState) {
  const answered = section.items.filter((i) => i.correct !== null).map((i) => ({ level: i.level, correct: i.correct! }));
  const missing = spec(section.key).items - answered.length;
  const lastLevel = section.items.at(-1)?.level ?? 3;
  return [...answered, ...Array.from({ length: Math.max(0, missing) }, () => ({ level: lastLevel, correct: false }))];
}

/**
 * Bring an attempt up to date: close a section whose time is up, start the
 * next one, or finish. An abandoned attempt is closed without starting more.
 */
function settle(row: Row, now: Date, opts: { abandon?: boolean } = {}): boolean {
  if (row.status === "finished") return false;
  let changed = false;
  for (const section of row.sections) {
    if (section.done) continue;
    if (!section.startedAt) {
      if (opts.abandon) {
        section.done = true;
        changed = true;
        continue;
      }
      begin(section, now);
      changed = true;
      break;
    }
    if (new Date(section.deadline!) <= now || opts.abandon) {
      section.done = true;
      Object.assign(section, estimateAbility(counted(section)));
      changed = true;
      continue;
    }
    break;
  }
  if (row.sections.every((s) => s.done)) {
    for (const s of row.sections) Object.assign(s, estimateAbility(counted(s)));
    const scores = Object.fromEntries(row.sections.map((s) => [s.key, scaledScore(s.theta)]));
    const values = Object.values(scores);
    row.scores = scores;
    row.score = Math.round(values.reduce((a, b) => a + b, 0) / values.length / 5) * 5;
    row.status = "finished";
    row.finishedAt = now;
    changed = true;
  }
  return changed;
}

async function save(db: DbOrTx, row: Row) {
  await db.update(adaptiveAttempts).set({ sections: row.sections, status: row.status, scores: row.scores, score: row.score, finishedAt: row.finishedAt }).where(eq(adaptiveAttempts.id, row.id));
}

// ---------- Students ----------

/** Sittings open now that this student is invited to, with whether they've taken each. */
async function openSittings(db: Db, ctx: Ctx) {
  const [units, rows] = await Promise.all([
    studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId),
    db.select().from(aptitudeSittings).where(and(eq(aptitudeSittings.tenantId, ctx.tenantId), lte(aptitudeSittings.opensAt, ctx.now), gt(aptitudeSittings.closesAt, ctx.now))),
  ]);
  const mine = rows.filter((s) => s.unitIds.length === 0 || s.unitIds.some((u) => units.includes(u)));
  const taken = mine.length
    ? await db.select({ sittingId: adaptiveAttempts.sittingId, id: adaptiveAttempts.id, status: adaptiveAttempts.status }).from(adaptiveAttempts).where(and(eq(adaptiveAttempts.userId, ctx.userId), inArray(adaptiveAttempts.sittingId, mine.map((s) => s.id))))
    : [];
  return mine.map((s) => {
    const a = taken.find((x) => x.sittingId === s.id);
    return { id: s.id, title: s.title, closesAt: s.closesAt, attempt: a ? { id: a.id, status: a.status } : null };
  });
}

/** Each student's official score: their latest finished sitting attempt in the last year. */
export async function officialAptitude(db: DbOrTx, tenantId: string, userIds: string[], now: Date) {
  if (!userIds.length) return new Map<string, { score: number; scores: Record<string, number>; at: Date }>();
  const since = new Date(now.getTime() - OFFICIAL_SCORE_MONTHS * 30.5 * 86_400_000);
  const rows = await db
    .selectDistinctOn([adaptiveAttempts.userId], { userId: adaptiveAttempts.userId, score: adaptiveAttempts.score, scores: adaptiveAttempts.scores, at: adaptiveAttempts.finishedAt })
    .from(adaptiveAttempts)
    .where(and(eq(adaptiveAttempts.tenantId, tenantId), inArray(adaptiveAttempts.userId, userIds), isNotNull(adaptiveAttempts.sittingId), eq(adaptiveAttempts.status, "finished"), gte(adaptiveAttempts.finishedAt, since)))
    .orderBy(adaptiveAttempts.userId, desc(adaptiveAttempts.finishedAt));
  return new Map(rows.map((r) => [r.userId, { score: r.score!, scores: r.scores!, at: r.at! }]));
}

export async function myAdaptive(db: Db, ctx: Ctx) {
  const rows = await db.select().from(adaptiveAttempts).where(eq(adaptiveAttempts.userId, ctx.userId)).orderBy(desc(adaptiveAttempts.startedAt)).limit(20);
  for (const r of rows) if (settle(r, ctx.now)) await save(db, r);
  const [sittings, official] = await Promise.all([openSittings(db, ctx), officialAptitude(db, ctx.tenantId, [ctx.userId], ctx.now)]);
  const mine = official.get(ctx.userId);
  return {
    inProgress: rows.find((r) => r.status === "in_progress")?.id ?? null,
    sittings,
    official: mine ? { ...mine, band: scoreBand(mine.score), bandLabel: SCORE_BANDS[scoreBand(mine.score)] } : null,
    attempts: rows
      .filter((r) => r.status === "finished")
      .sort((a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime())
      .slice(0, 10)
      .map((r) => ({ id: r.id, official: Boolean(r.sittingId), score: r.score!, scores: r.scores!, band: scoreBand(r.score!), bandLabel: SCORE_BANDS[scoreBand(r.score!)], finishedAt: r.finishedAt })),
    sections: ADAPTIVE_SECTIONS,
    templates: APTITUDE_TEMPLATES,
  };
}

export async function startAdaptive(db: Db, ctx: Ctx, sittingId: string | null = null) {
  const [open] = await db.select().from(adaptiveAttempts).where(and(eq(adaptiveAttempts.userId, ctx.userId), eq(adaptiveAttempts.status, "in_progress")));
  if (open && settle(open, ctx.now)) await save(db, open);
  const stillOpen = open?.status === "in_progress" ? open : null;
  if (sittingId) {
    const sitting = (await openSittings(db, ctx)).find((s) => s.id === sittingId);
    if (!sitting) throw notFound("Open sitting");
    if (sitting.attempt?.status === "in_progress") return { id: sitting.attempt.id };
    if (sitting.attempt) throw conflict("taken", "You've taken this sitting; your score is in");
    if (stillOpen?.sittingId) throw conflict("other_official", "Finish the official test you've started first");
    // The official test takes over from a practice test left open.
    if (stillOpen) {
      settle(stillOpen, ctx.now, { abandon: true });
      await save(db, stillOpen);
    }
  } else if (stillOpen) return { id: stillOpen.id };
  const sections: AdaptiveSectionState[] = ADAPTIVE_SECTIONS.map((s) => ({ key: s.key, items: [], theta: 0, se: 1, startedAt: null, deadline: null, done: false }));
  begin(sections[0]!, ctx.now);
  const [row] = await db.insert(adaptiveAttempts).values({ tenantId: ctx.tenantId, userId: ctx.userId, sittingId, sections, startedAt: ctx.now }).returning();
  return { id: row!.id };
}

async function percentile(db: Db, tenantId: string, userId: string, score: number) {
  const rows = await db
    .selectDistinctOn([adaptiveAttempts.userId], { userId: adaptiveAttempts.userId, score: adaptiveAttempts.score })
    .from(adaptiveAttempts)
    .where(and(eq(adaptiveAttempts.tenantId, tenantId), eq(adaptiveAttempts.status, "finished")))
    .orderBy(adaptiveAttempts.userId, desc(adaptiveAttempts.finishedAt));
  const others = rows.filter((r) => r.userId !== userId);
  if (others.length + 1 < MIN_FOR_PERCENTILE) return { percentile: null, others: others.length };
  return { percentile: Math.round((others.filter((r) => r.score! < score).length / others.length) * 100), others: others.length };
}

export async function adaptiveView(db: Db, ctx: Ctx, id: string) {
  const [row] = await db.select().from(adaptiveAttempts).where(and(eq(adaptiveAttempts.id, id), eq(adaptiveAttempts.userId, ctx.userId)));
  if (!row) throw notFound("Test");
  if (settle(row, ctx.now)) await save(db, row);
  if (row.status === "in_progress") {
    const index = row.sections.findIndex((s) => !s.done);
    const section = row.sections[index]!;
    const s = spec(section.key);
    const item = section.items.at(-1)!;
    return {
      id: row.id,
      status: row.status,
      official: Boolean(row.sittingId),
      section: { index, total: row.sections.length, key: s.key, title: s.title, items: s.items, minutes: s.minutes, deadline: section.deadline },
      question: { number: section.items.length, prompt: item.prompt, options: item.options },
    };
  }
  return {
    id: row.id,
    status: row.status,
    official: Boolean(row.sittingId),
    score: row.score!,
    band: scoreBand(row.score!),
    bandLabel: SCORE_BANDS[scoreBand(row.score!)],
    ...(await percentile(db, ctx.tenantId, ctx.userId, row.score!)),
    finishedAt: row.finishedAt,
    sections: row.sections.map((sec) => {
      const s = spec(sec.key);
      const score = row.scores![sec.key]!;
      const answered = sec.items.filter((i) => i.correct !== null);
      return {
        key: sec.key,
        title: s.title,
        score,
        band: scoreBand(score),
        bandLabel: SCORE_BANDS[scoreBand(score)],
        // A band of one standard error each way: the score is an estimate.
        range: [scaledScore(sec.theta - sec.se), scaledScore(sec.theta + sec.se)],
        answered: answered.length,
        correct: answered.filter((i) => i.correct).length,
        notReached: s.items - answered.length,
        highestLevel: Math.max(0, ...answered.filter((i) => i.correct).map((i) => i.level)),
        items: sec.items.map((i) => ({ prompt: i.prompt, options: i.options, answer: i.answer, chosen: i.chosen, correct: i.correct, level: i.level, template: i.template, explanation: i.explanation })),
      };
    }),
  };
}

export async function answerAdaptive(db: Db, ctx: Ctx, id: string, input: { number: number; chosen: number }) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(adaptiveAttempts).where(and(eq(adaptiveAttempts.id, id), eq(adaptiveAttempts.userId, ctx.userId))).for("update");
    if (!row) throw notFound("Test");
    if (settle(row, ctx.now)) {
      // Time ran out first: the answer is too late.
      await save(tx, row);
      throw conflict("time_up", "Time's up for that section");
    }
    if (row.status !== "in_progress") throw conflict("finished", "This test is over");
    const section = row.sections.find((s) => !s.done)!;
    const item = section.items.at(-1)!;
    if (input.number !== section.items.length || item.chosen !== null) throw conflict("answered", "That question has been answered");
    if (input.chosen < 0 || input.chosen >= item.options.length) throw badRequest("Choose one of the options");
    item.chosen = input.chosen;
    item.correct = input.chosen === item.answer;
    item.answeredAt = ctx.now.toISOString();
    Object.assign(section, estimateAbility(section.items.filter((i) => i.correct !== null).map((i) => ({ level: i.level, correct: i.correct! }))));
    if (section.items.length >= spec(section.key).items) {
      section.done = true;
      settle(row, ctx.now);
    } else ask(section, ctx.now);
    await save(tx, row);
  });
  return adaptiveView(db, ctx, id);
}

/** Hourly: finish attempts left with a section's time run out a day ago. */
export async function finalizeAbandonedAdaptive(db: Db, now: Date) {
  const rows = await db.select().from(adaptiveAttempts).where(eq(adaptiveAttempts.status, "in_progress"));
  let finished = 0;
  for (const r of rows) {
    const open = r.sections.find((s) => !s.done);
    if (!open?.deadline || new Date(open.deadline).getTime() + ABANDONED_MS > now.getTime()) continue;
    settle(r, now, { abandon: true });
    await save(db, r);
    finished++;
  }
  return finished;
}

// ---------- Drills ----------

/** A fresh question to practise; the answer stays on the server until it's checked. */
export function drillQuestion(template: string, level: number) {
  if (!APTITUDE_TEMPLATES.some((t) => t.id === template)) throw notFound("Topic");
  const q = generateQuestion(template, level, newSeed());
  return { template: q.template, level: q.level, seed: q.seed, prompt: q.prompt, options: q.options };
}

/** Check a drill answer by rebuilding the question from its seed. */
export function checkDrill(input: { template: string; level: number; seed: number; chosen: number }) {
  if (!APTITUDE_TEMPLATES.some((t) => t.id === input.template)) throw notFound("Topic");
  const q = generateQuestion(input.template, input.level, input.seed);
  return { correct: input.chosen === q.answer, answer: q.answer, explanation: q.explanation };
}

// ---------- Staff ----------

/** Each student's latest adaptive score, for the students in scope. */
export async function aptitudeScores(db: Db, auth: AuthContext) {
  const tenantId = auth.tenantId!;
  const [units, ids] = await Promise.all([tenantUnits(db, tenantId), scopedUnitIds(db, auth).then((u) => studentIdsInUnits(db, tenantId, u))]);
  if (!ids.length) return { students: [], summary: { students: 0, tested: 0, average: null, bands: { strong: 0, good: 0, developing: 0, needs_work: 0 } } };
  const [people, unitRows, latest, official] = await Promise.all([
    db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)),
    db.select({ userId: memberships.userId, unitId: memberships.orgUnitId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student"), inArray(memberships.userId, ids))),
    db
      .selectDistinctOn([adaptiveAttempts.userId])
      .from(adaptiveAttempts)
      .where(and(eq(adaptiveAttempts.tenantId, tenantId), eq(adaptiveAttempts.status, "finished"), inArray(adaptiveAttempts.userId, ids)))
      .orderBy(adaptiveAttempts.userId, desc(adaptiveAttempts.finishedAt)),
    officialAptitude(db, tenantId, ids, new Date()),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const byUser = new Map(latest.map((a) => [a.userId, a]));
  const students = people
    .map((p) => {
      const a = byUser.get(p.id);
      const unit = unitRows.find((u) => u.userId === p.id)?.unitId;
      const o = official.get(p.id);
      return { id: p.id, name: p.name, rollNo: p.rollNo, unit: unit ? (unitName.get(unit) ?? null) : null, score: a?.score ?? null, scores: a?.scores ?? null, band: a ? scoreBand(a.score!) : null, at: a?.finishedAt ?? null, official: o ? { score: o.score, at: o.at } : null };
    })
    .sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || x.name.localeCompare(y.name));
  const tested = students.filter((s) => s.score !== null);
  const bands = { strong: 0, good: 0, developing: 0, needs_work: 0 };
  for (const s of tested) bands[s.band!]++;
  return {
    students,
    summary: { students: students.length, tested: tested.length, average: tested.length ? Math.round(tested.reduce((n, s) => n + s.score!, 0) / tested.length) : null, bands },
  };
}

// ---------- Sittings ----------

export interface SittingInput {
  title: string;
  unitIds: string[];
  opensAt: Date;
  closesAt: Date;
}

const MAX_SITTING_DAYS = 14;

async function invited(db: Db, tenantId: string, unitIds: string[]) {
  const units = await tenantUnits(db, tenantId);
  return studentIdsInUnits(db, tenantId, unitIds.length ? descendants(units, unitIds) : units.map((u) => u.id));
}

export async function createSitting(db: Db, auth: AuthContext, input: SittingInput, now: Date) {
  const tenantId = auth.tenantId!;
  if (input.closesAt <= input.opensAt) throw badRequest("It has to close after it opens");
  if (input.closesAt <= now) throw badRequest("It has to close in the future");
  if (input.closesAt.getTime() - input.opensAt.getTime() > MAX_SITTING_DAYS * 86_400_000) throw badRequest(`Keep a sitting to ${MAX_SITTING_DAYS} days or less`);
  const scoped = new Set(await scopedUnitIds(db, auth));
  if (input.unitIds.some((u) => !scoped.has(u))) throw badRequest("Choose batches in your scope");
  const [row] = await db.insert(aptitudeSittings).values({ tenantId, title: input.title.trim(), unitIds: input.unitIds, opensAt: input.opensAt, closesAt: input.closesAt, createdBy: auth.userId, createdAt: now }).returning();
  const students = await invited(db, tenantId, input.unitIds);
  const when = input.opensAt <= now ? "now" : input.opensAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  await enqueue(
    db,
    students.map((userId) => ({
      tenantId,
      userId,
      template: "placement" as const,
      title: `Official aptitude test: ${row!.title}`,
      body: `Opens ${when}, closes ${row!.closesAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}. You get one attempt; the score goes on your resume and counts for drives that ask for it.`,
      link: appLink("/play/aptitude"),
      dedupeKey: `sitting:${row!.id}:${userId}`,
      sentBy: auth.userId,
    })),
  );
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId, actorId: auth.userId, action: "aptitude.sitting.create", target: row!.id, data: { students: students.length } });
  return { id: row!.id, invited: students.length };
}

async function loadSitting(db: Db, auth: AuthContext, id: string) {
  const [row] = await db.select().from(aptitudeSittings).where(and(eq(aptitudeSittings.id, id), eq(aptitudeSittings.tenantId, auth.tenantId!)));
  if (!row) throw notFound("Sitting");
  return row;
}

/** Every sitting, newest first, with how many have taken it and how they did. */
export async function listSittings(db: Db, auth: AuthContext, now: Date) {
  const tenantId = auth.tenantId!;
  const rows = await db.select().from(aptitudeSittings).where(eq(aptitudeSittings.tenantId, tenantId)).orderBy(desc(aptitudeSittings.opensAt));
  const attempts = rows.length ? await db.select({ sittingId: adaptiveAttempts.sittingId, status: adaptiveAttempts.status, score: adaptiveAttempts.score }).from(adaptiveAttempts).where(inArray(adaptiveAttempts.sittingId, rows.map((r) => r.id))) : [];
  const units = await tenantUnits(db, tenantId);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const out = [];
  for (const r of rows) {
    const mine = attempts.filter((a) => a.sittingId === r.id);
    const done = mine.filter((a) => a.status === "finished");
    out.push({
      id: r.id,
      title: r.title,
      units: r.unitIds.map((u) => unitName.get(u) ?? "").filter(Boolean),
      opensAt: r.opensAt,
      closesAt: r.closesAt,
      state: r.opensAt > now ? "upcoming" : r.closesAt > now ? "open" : "closed",
      invited: (await invited(db, tenantId, r.unitIds)).length,
      started: mine.length,
      finished: done.length,
      average: done.length ? Math.round(done.reduce((n, a) => n + a.score!, 0) / done.length) : null,
    });
  }
  return { sittings: out };
}

/** Everyone invited to a sitting, with their score or where they stand. */
export async function sittingResults(db: Db, auth: AuthContext, id: string) {
  const sitting = await loadSitting(db, auth, id);
  const ids = await invited(db, auth.tenantId!, sitting.unitIds);
  const scoped = new Set(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth)));
  const inScope = ids.filter((u) => scoped.has(u));
  const [people, attempts] = await Promise.all([
    inScope.length ? db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, inScope)) : [],
    db.select().from(adaptiveAttempts).where(eq(adaptiveAttempts.sittingId, id)),
  ]);
  const students = people
    .map((p) => {
      const a = attempts.find((x) => x.userId === p.id);
      return { id: p.id, name: p.name, rollNo: p.rollNo, status: a ? a.status : ("not_started" as const), score: a?.score ?? null, scores: a?.scores ?? null, band: a?.score != null ? scoreBand(a.score) : null };
    })
    .sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || (x.rollNo ?? x.name).localeCompare(y.rollNo ?? y.name, "en", { numeric: true }));
  return { sitting: { id: sitting.id, title: sitting.title, opensAt: sitting.opensAt, closesAt: sitting.closesAt }, students };
}

export function sittingCsv(r: Awaited<ReturnType<typeof sittingResults>>): string {
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  return [
    ["roll_no", "name", "status", "score", "quantitative", "reasoning", "band"].join(","),
    ...r.students.map((s) => [s.rollNo, s.name, s.status, s.score, s.scores?.quant, s.scores?.reasoning, s.band].map(cell).join(",")),
  ].join("\n");
}

/** Close a sitting now; attempts already started run to the end of their sections. */
export async function closeSitting(db: Db, auth: AuthContext, id: string, now: Date) {
  const sitting = await loadSitting(db, auth, id);
  if (sitting.closesAt <= now) throw conflict("closed", "It has already closed");
  await db.update(aptitudeSittings).set({ closesAt: now, opensAt: sitting.opensAt > now ? now : sitting.opensAt }).where(eq(aptitudeSittings.id, id));
  await audit(db, { tenantId: auth.tenantId!, actorId: auth.userId, action: "aptitude.sitting.close", target: id });
  return { ok: true };
}
