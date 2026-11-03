import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { masteryFromRating } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { certificates, learningPaths, packs, sessions, skillRatings, skills, users, type PathStep } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { certificateCode } from "./certificates";
import { descendants, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits } from "./scope";
import { emitAndDeliver } from "./webhooks";

// Learning paths: an ordered set of skills to master and missions to pass,
// with deadlines, for a group of learners. Progress is read from what students
// already do (skill ratings, finished mission sessions), so there is nothing
// extra to record; finishing every step earns a verifiable certificate.

/** A skill counts as mastered only after enough answers, so one lucky streak isn't enough. */
export const MIN_SKILL_ATTEMPTS = 5;
export const DEFAULT_SKILL_TARGET = 60;

type PathRow = typeof learningPaths.$inferSelect;
export type StepState = "done" | "current" | "open" | "locked";

export interface StepProgress {
  stepId: string;
  state: StepState;
  /** Mastery % (skill) or best score % (pack); null before any attempt. */
  value: number | null;
  dueAt: string | null;
  overdue: boolean;
}

export interface NewPath {
  title: string;
  description: string;
  unitIds: string[];
  steps: { kind: "skill" | "pack"; ref: string; target?: number; dueDays?: number | null }[];
  sequential: boolean;
  startsAt: Date;
}

export async function createPath(db: Db, args: NewPath & { tenantId: string; actorId: string }) {
  if (args.steps.length === 0) throw badRequest("Add at least one step");
  const skillIds = args.steps.filter((s) => s.kind === "skill").map((s) => s.ref);
  const packIds = args.steps.filter((s) => s.kind === "pack").map((s) => s.ref);
  const skillRows = skillIds.length ? await db.select().from(skills).where(inArray(skills.id, skillIds)) : [];
  const packRows = packIds.length
    ? await db
        .select()
        .from(packs)
        .where(and(inArray(packs.id, packIds), or(isNull(packs.tenantId), eq(packs.tenantId, args.tenantId))))
    : [];
  const steps: PathStep[] = args.steps.map((s, i) => {
    if (s.kind === "skill") {
      const skill = skillRows.find((r) => r.id === s.ref);
      if (!skill) throw badRequest(`Unknown skill ${s.ref}`);
      return { id: `s${i + 1}`, kind: "skill", ref: s.ref, title: `${skill.topicName}: ${skill.name}`, target: s.target ?? DEFAULT_SKILL_TARGET, dueDays: s.dueDays ?? null };
    }
    const pack = packRows.find((r) => r.id === s.ref);
    if (!pack) throw badRequest(`Unknown mission ${s.ref}`);
    return { id: `s${i + 1}`, kind: "pack", ref: s.ref, title: pack.title, target: s.target ?? pack.passMark, dueDays: s.dueDays ?? null };
  });
  const [row] = await db
    .insert(learningPaths)
    .values({ tenantId: args.tenantId, title: args.title, description: args.description, orgUnitIds: args.unitIds, steps, sequential: args.sequential, startsAt: args.startsAt, createdBy: args.actorId })
    .returning();
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "path.create", target: row!.id, data: { title: args.title, steps: steps.length } });
  return row!;
}

const dueAt = (path: PathRow, step: PathStep) => (step.dueDays === null ? null : new Date(path.startsAt.getTime() + step.dueDays * 86_400_000));

/** Each learner's state on each step of the path. */
export async function pathProgress(db: DbOrTx, path: PathRow, userIds: string[], now: Date): Promise<Map<string, StepProgress[]>> {
  const out = new Map<string, StepProgress[]>();
  if (userIds.length === 0) return out;
  const skillIds = path.steps.filter((s) => s.kind === "skill").map((s) => s.ref);
  const packIds = path.steps.filter((s) => s.kind === "pack").map((s) => s.ref);
  const ratings = skillIds.length
    ? await db.select().from(skillRatings).where(and(inArray(skillRatings.userId, userIds), inArray(skillRatings.skillId, skillIds)))
    : [];
  const runs = packIds.length
    ? await db
        .select({ userId: sessions.userId, packId: sessions.packId, correct: sessions.correctCount, questionIds: sessions.questionIds })
        .from(sessions)
        .where(and(inArray(sessions.userId, userIds), eq(sessions.kind, "pack"), inArray(sessions.packId, packIds), isNotNull(sessions.finishedAt)))
    : [];

  for (const userId of userIds) {
    let blocked = false;
    const steps: StepProgress[] = path.steps.map((step) => {
      let value: number | null = null;
      let done = false;
      if (step.kind === "skill") {
        const r = ratings.find((x) => x.userId === userId && x.skillId === step.ref);
        if (r && r.attempts > 0) {
          value = masteryFromRating(r.rating);
          done = r.attempts >= MIN_SKILL_ATTEMPTS && value >= step.target;
        }
      } else {
        const scores = runs.filter((x) => x.userId === userId && x.packId === step.ref).map((x) => Math.round((x.correct / Math.max(1, x.questionIds.length)) * 100));
        if (scores.length) {
          value = Math.max(...scores);
          done = value >= step.target;
        }
      }
      const due = dueAt(path, step);
      let state: StepState;
      if (done) state = "done";
      else if (!path.sequential) state = "open";
      else if (!blocked) {
        state = "current";
        blocked = true;
      } else state = "locked";
      return { stepId: step.id, state, value, dueAt: due?.toISOString() ?? null, overdue: !done && due !== null && due < now };
    });
    out.set(userId, steps);
  }
  return out;
}

const isComplete = (steps: StepProgress[]) => steps.every((s) => s.state === "done");

async function loadPath(db: DbOrTx, tenantId: string, id: string) {
  const [path] = await db.select().from(learningPaths).where(and(eq(learningPaths.id, id), eq(learningPaths.tenantId, tenantId)));
  if (!path) throw notFound("Learning path");
  return path;
}

async function learnersOf(db: DbOrTx, path: PathRow) {
  return studentIdsInUnits(db, path.tenantId, descendants(await tenantUnits(db, path.tenantId), path.orgUnitIds));
}

function summarise(path: PathRow, progress: Map<string, StepProgress[]>) {
  const all = [...progress.values()];
  return {
    learners: all.length,
    completed: all.filter(isComplete).length,
    overdue: all.filter((steps) => steps.some((s) => s.overdue)).length,
    steps: path.steps.map((step, i) => ({ ...step, done: all.filter((p) => p[i]!.state === "done").length })),
  };
}

/** Paths visible to a staff member (any target unit in their scope), with headline numbers. */
export async function listPaths(db: Db, tenantId: string, scopedUnits: string[], now: Date) {
  const scoped = new Set(scopedUnits);
  const rows = (await db.select().from(learningPaths).where(eq(learningPaths.tenantId, tenantId))).filter((p) => p.orgUnitIds.some((u) => scoped.has(u)));
  const units = await tenantUnits(db, tenantId);
  const name = new Map(units.map((u) => [u.id, u.name]));
  const out = [];
  for (const p of rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const progress = await pathProgress(db, p, await learnersOf(db, p), now);
    const { learners, completed, overdue } = summarise(p, progress);
    out.push({ id: p.id, title: p.title, status: p.status, units: p.orgUnitIds.map((id) => ({ id, name: name.get(id) ?? "" })), stepCount: p.steps.length, startsAt: p.startsAt, learners, completed, overdue });
  }
  return out;
}

/** The manager's view: every learner's progress on every step. */
export async function pathDetail(db: Db, tenantId: string, id: string, now: Date) {
  const path = await loadPath(db, tenantId, id);
  const ids = await learnersOf(db, path);
  const progress = await pathProgress(db, path, ids, now);
  const people = ids.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo, email: users.email }).from(users).where(inArray(users.id, ids)) : [];
  const rows = people
    .map((u) => {
      const steps = progress.get(u.id)!;
      return { ...u, steps, done: steps.filter((s) => s.state === "done").length, overdue: steps.some((s) => s.overdue), completed: isComplete(steps) };
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.done - b.done || a.name.localeCompare(b.name));
  return { path: { id: path.id, title: path.title, description: path.description, sequential: path.sequential, startsAt: path.startsAt, status: path.status, orgUnitIds: path.orgUnitIds }, summary: summarise(path, progress), learners: rows };
}

export function pathCsv(detail: Awaited<ReturnType<typeof pathDetail>>): string {
  const esc = (v: unknown) => {
    const t = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const header = ["name", "roll_no", "email", "steps_done", "completed", "overdue", ...detail.summary.steps.map((s) => s.title)];
  return [
    header.map(esc).join(","),
    ...detail.learners.map((l) => [l.name, l.rollNo, l.email, l.done, l.completed, l.overdue, ...l.steps.map((s) => (s.state === "done" ? "done" : s.value === null ? "" : `${s.value}%`))].map(esc).join(",")),
  ].join("\n");
}

export async function archivePath(db: Db, tenantId: string, actorId: string, id: string) {
  await loadPath(db, tenantId, id);
  await db.update(learningPaths).set({ status: "archived" }).where(eq(learningPaths.id, id));
  await audit(db, { tenantId, actorId, action: "path.archive", target: id });
}

/** A student's active paths with their own progress. */
export async function studentPaths(db: Db, ctx: { tenantId: string; userId: string; now: Date }) {
  const mine = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  const rows = (await db.select().from(learningPaths).where(and(eq(learningPaths.tenantId, ctx.tenantId), eq(learningPaths.status, "active")))).filter(
    (p) => p.startsAt <= ctx.now && p.orgUnitIds.some((u) => mine.has(u)),
  );
  const certs = await db.select({ refId: certificates.refId, code: certificates.code }).from(certificates).where(and(eq(certificates.userId, ctx.userId), eq(certificates.kind, "path")));
  const out = [];
  for (const p of rows) {
    const steps = (await pathProgress(db, p, [ctx.userId], ctx.now)).get(ctx.userId)!;
    out.push({
      id: p.id,
      title: p.title,
      description: p.description,
      sequential: p.sequential,
      steps: p.steps.map((s, i) => ({ ...s, ...steps[i]! })),
      done: steps.filter((s) => s.state === "done").length,
      certificate: certs.find((c) => c.refId === p.id)?.code ?? null,
    });
  }
  return out;
}

/**
 * After a student finishes a session: issue a certificate for every path they
 * have now completed. Safe to call repeatedly; each path certifies once.
 */
export async function checkPathCompletion(db: Db, ctx: { tenantId: string; userId: string; now: Date }) {
  const done: { pathId: string; title: string; code: string }[] = [];
  for (const p of await studentPaths(db, ctx)) {
    if (p.certificate || p.done < p.steps.length) continue;
    const [cert] = await db
      .insert(certificates)
      .values({ code: certificateCode(), tenantId: ctx.tenantId, userId: ctx.userId, kind: "path", refId: p.id, title: p.title, scorePct: 100, issuedAt: ctx.now })
      .onConflictDoNothing()
      .returning({ code: certificates.code });
    if (!cert) continue;
    done.push({ pathId: p.id, title: p.title, code: cert.code });
    emitAndDeliver(db, ctx.tenantId, "path.completed", { pathId: p.id, title: p.title, userId: ctx.userId, certificate: cert.code }, ctx.now);
  }
  return done;
}
