import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  ADAPTIVE_SECTIONS,
  APTITUDE_TEMPLATES,
  estimateAbility,
  generateQuestion,
  nextLevel,
  nextTemplate,
  scaledScore,
  SCORE_BANDS,
  scoreBand,
} from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { adaptiveAttempts, memberships, users, type AdaptiveItem, type AdaptiveSectionState } from "../db/schema";
import { badRequest, conflict, notFound } from "../lib/errors";
import { scopedUnitIds, studentIdsInUnits, tenantUnits, type AuthContext } from "./scope";

// The adaptive aptitude test, and drills on the same generated questions.
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

export async function myAdaptive(db: Db, ctx: Ctx) {
  const rows = await db.select().from(adaptiveAttempts).where(eq(adaptiveAttempts.userId, ctx.userId)).orderBy(desc(adaptiveAttempts.startedAt)).limit(20);
  for (const r of rows) if (settle(r, ctx.now)) await save(db, r);
  return {
    inProgress: rows.find((r) => r.status === "in_progress")?.id ?? null,
    attempts: rows
      .filter((r) => r.status === "finished")
      .slice(0, 10)
      .map((r) => ({ id: r.id, score: r.score!, scores: r.scores!, band: scoreBand(r.score!), bandLabel: SCORE_BANDS[scoreBand(r.score!)], finishedAt: r.finishedAt })),
    sections: ADAPTIVE_SECTIONS,
    templates: APTITUDE_TEMPLATES,
  };
}

export async function startAdaptive(db: Db, ctx: Ctx) {
  const [open] = await db.select().from(adaptiveAttempts).where(and(eq(adaptiveAttempts.userId, ctx.userId), eq(adaptiveAttempts.status, "in_progress")));
  if (open) {
    if (settle(open, ctx.now)) await save(db, open);
    if (open.status === "in_progress") return { id: open.id };
  }
  const sections: AdaptiveSectionState[] = ADAPTIVE_SECTIONS.map((s) => ({ key: s.key, items: [], theta: 0, se: 1, startedAt: null, deadline: null, done: false }));
  begin(sections[0]!, ctx.now);
  const [row] = await db.insert(adaptiveAttempts).values({ tenantId: ctx.tenantId, userId: ctx.userId, sections, startedAt: ctx.now }).returning();
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
      section: { index, total: row.sections.length, key: s.key, title: s.title, items: s.items, minutes: s.minutes, deadline: section.deadline },
      question: { number: section.items.length, prompt: item.prompt, options: item.options },
    };
  }
  return {
    id: row.id,
    status: row.status,
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
  const [people, unitRows, latest] = await Promise.all([
    db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)),
    db.select({ userId: memberships.userId, unitId: memberships.orgUnitId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student"), inArray(memberships.userId, ids))),
    db
      .selectDistinctOn([adaptiveAttempts.userId])
      .from(adaptiveAttempts)
      .where(and(eq(adaptiveAttempts.tenantId, tenantId), eq(adaptiveAttempts.status, "finished"), inArray(adaptiveAttempts.userId, ids)))
      .orderBy(adaptiveAttempts.userId, desc(adaptiveAttempts.finishedAt)),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const byUser = new Map(latest.map((a) => [a.userId, a]));
  const students = people
    .map((p) => {
      const a = byUser.get(p.id);
      const unit = unitRows.find((u) => u.userId === p.id)?.unitId;
      return { id: p.id, name: p.name, rollNo: p.rollNo, unit: unit ? (unitName.get(unit) ?? null) : null, score: a?.score ?? null, scores: a?.scores ?? null, band: a ? scoreBand(a.score!) : null, at: a?.finishedAt ?? null };
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
