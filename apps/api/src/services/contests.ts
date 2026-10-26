import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { codeSimilarity, contestState, scoreboard, toStudentView, type StudentResponse, type Verdict } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { contests, contestSubmissions, questions, tenants, users } from "../db/schema";
import { evaluate, tryRun, checkRunRate, type Evaluation } from "../execution";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { appLink, enqueue } from "./notifications";
import { toCoreQuestion } from "./practice";
import { descendants, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits } from "./scope";

// Coding contests: a fixed set of coding and SQL problems, a start and an end,
// unlimited submissions judged on every test, and an ICPC scoreboard that
// freezes for the last minutes. A college runs one for chosen batches; PlayCode
// runs inter-college ones, where students appear by first name and initial.

type Contest = typeof contests.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };

const MAX_PROBLEMS = 12;
const MAX_HOURS = 24;
/** Submissions a student may make per contest per minute. */
const SUBMITS_PER_MINUTE = 6;
const SIMILARITY_FLAG = 0.85;
const BOARD_ROWS = 100;
export const LETTERS = "ABCDEFGHIJKL";

export interface ContestInput {
  title: string;
  description: string;
  problemIds: string[];
  audienceIds: string[];
  startsAt: Date;
  endsAt: Date;
  freezeMinutes: number;
}

/** What a submission's evaluation means on the scoreboard. */
export function verdictOf(e: Evaluation): Verdict {
  if (e.correct) return "accepted";
  if (e.kind === "code") {
    if (e.compileError) return "compile_error";
    if (e.tests.some((t) => t.status === "timeout")) return "time_limit";
    if (e.tests.some((t) => t.status === "runtime_error" || t.status === "output_limit")) return "runtime_error";
  } else if (!e.result.ok) return "runtime_error";
  return "wrong_answer";
}

async function validate(db: Db, tenantId: string | null, input: ContestInput, now: Date) {
  const ids = [...new Set(input.problemIds)];
  if (ids.length === 0 || ids.length > MAX_PROBLEMS) throw badRequest(`Choose 1 to ${MAX_PROBLEMS} problems`);
  const rows = await db.select().from(questions).where(inArray(questions.id, ids));
  for (const id of ids) {
    const q = rows.find((r) => r.id === id);
    const visible = q && q.status === "live" && (q.tenantId === null || q.tenantId === tenantId);
    if (!visible) throw badRequest(`Problem ${id} isn't available`);
    if (q.type !== "write_code" && q.type !== "sql_query") throw badRequest(`${id} isn't a coding or SQL problem`);
  }
  const minutes = (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000;
  if (minutes < 15 || minutes > MAX_HOURS * 60) throw badRequest(`A contest runs between 15 minutes and ${MAX_HOURS} hours`);
  if (input.endsAt <= now) throw badRequest("The contest must end in the future");
  if (input.freezeMinutes < 0 || input.freezeMinutes >= minutes) throw badRequest("The freeze must be shorter than the contest");
  return ids;
}

/** Students who may take part, for notifications. */
async function participantIds(db: Db, c: Contest): Promise<{ tenantId: string; userId: string }[]> {
  if (c.tenantId) {
    const units = await tenantUnits(db, c.tenantId);
    const scope = c.audienceIds.length ? descendants(units, c.audienceIds) : units.map((u) => u.id);
    return (await studentIdsInUnits(db, c.tenantId, scope)).map((userId) => ({ tenantId: c.tenantId!, userId }));
  }
  const out: { tenantId: string; userId: string }[] = [];
  for (const tenantId of c.audienceIds) {
    const units = await tenantUnits(db, tenantId);
    for (const userId of await studentIdsInUnits(db, tenantId, units.map((u) => u.id))) out.push({ tenantId, userId });
  }
  return out;
}

export async function createContest(db: Db, args: { tenantId: string | null; actorId: string; input: ContestInput; now: Date }) {
  const problemIds = await validate(db, args.tenantId, args.input, args.now);
  if (!args.tenantId) {
    const colleges = args.input.audienceIds.length ? await db.select({ id: tenants.id, type: tenants.type }).from(tenants).where(inArray(tenants.id, args.input.audienceIds)) : [];
    if (colleges.length === 0 || colleges.length !== new Set(args.input.audienceIds).size || colleges.some((c) => c.type !== "institution")) throw badRequest("Choose the colleges taking part");
  }
  const [c] = await db
    .insert(contests)
    .values({ tenantId: args.tenantId, ...args.input, problemIds, createdBy: args.actorId, createdAt: args.now })
    .returning();
  const when = args.input.startsAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  await enqueue(
    db,
    (await participantIds(db, c!)).map((p) => ({
      tenantId: p.tenantId,
      userId: p.userId,
      template: "contest" as const,
      title: `Coding contest: ${c!.title}`,
      body: `${problemIds.length} problem${problemIds.length === 1 ? "" : "s"}, starts ${when}.`,
      link: appLink(`/play/contests/${c!.id}`),
      dedupeKey: `contest:${c!.id}:${p.userId}`,
    })),
  );
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "contest.create", target: c!.id, data: { problems: problemIds.length } });
  return c!;
}

async function loadContest(db: DbOrTx, id: string): Promise<Contest> {
  const [c] = await db.select().from(contests).where(eq(contests.id, id));
  if (!c) throw notFound("Contest");
  return c;
}

async function canEnter(db: DbOrTx, c: Contest, ctx: Ctx): Promise<boolean> {
  if (!c.tenantId) return c.audienceIds.includes(ctx.tenantId);
  if (c.tenantId !== ctx.tenantId) return false;
  if (c.audienceIds.length === 0) return true;
  const mine = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  return c.audienceIds.some((id) => mine.has(id));
}

async function enterable(db: DbOrTx, id: string, ctx: Ctx) {
  const c = await loadContest(db, id);
  if (!(await canEnter(db, c, ctx))) throw notFound("Contest");
  return c;
}

/** Contests a student can see: upcoming, running, or ended in the last 30 days. */
export async function studentContests(db: Db, ctx: Ctx) {
  const rows = await db
    .select()
    .from(contests)
    .where(and(or(eq(contests.tenantId, ctx.tenantId), and(isNull(contests.tenantId), sql`${contests.audienceIds} ? ${ctx.tenantId}`)), gte(contests.endsAt, new Date(ctx.now.getTime() - 30 * 86_400_000))))
    .orderBy(desc(contests.startsAt));
  const mine = [];
  for (const c of rows) if (await canEnter(db, c, ctx)) mine.push(c);
  const subs = mine.length
    ? await db.select().from(contestSubmissions).where(and(eq(contestSubmissions.userId, ctx.userId), inArray(contestSubmissions.contestId, mine.map((c) => c.id))))
    : [];
  return {
    contests: mine.map((c) => ({
      id: c.id,
      title: c.title,
      byPlayCode: c.tenantId === null,
      state: contestState(c, ctx.now),
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      problems: c.problemIds.length,
      solved: new Set(subs.filter((s) => s.contestId === c.id && s.verdict === "accepted").map((s) => s.questionId)).size,
    })),
  };
}

/** Display names for a scoreboard: full names in a college contest; first name and initial, with the college, across colleges. */
async function names(db: DbOrTx, c: Contest, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { name: string; college: string | null; rollNo: string | null }>();
  const rows = await db.select({ id: users.id, name: users.name, rollNo: users.rollNo, college: tenants.name }).from(users).leftJoin(tenants, eq(tenants.id, users.tenantId)).where(inArray(users.id, userIds));
  const short = (n: string) => {
    const [first, ...rest] = n.trim().split(/\s+/);
    return rest.length ? `${first} ${rest.at(-1)![0]}.` : first!;
  };
  return new Map(rows.map((r) => [r.id, c.tenantId ? { name: r.name, college: null, rollNo: r.rollNo } : { name: short(r.name), college: r.college, rollNo: null }]));
}

async function board(db: DbOrTx, c: Contest, now: Date, opts: { frozen: boolean; staff?: boolean }) {
  const subs = await db.select().from(contestSubmissions).where(eq(contestSubmissions.contestId, c.id));
  const start = c.startsAt.getTime();
  const freezeAtMs = opts.frozen && contestState(c, now) === "frozen" ? (c.endsAt.getTime() - c.freezeMinutes * 60_000) - start : null;
  const rows = scoreboard(
    subs.map((s) => ({ userId: s.userId, questionId: s.questionId, verdict: s.verdict, atMs: s.createdAt.getTime() - start })),
    c.problemIds,
    { freezeAtMs },
  );
  return { rows, subs, frozen: freezeAtMs !== null };
}

/** The contest for a student: problems once it starts, their own submissions, and the (possibly frozen) scoreboard. */
export async function contestView(db: Db, ctx: Ctx, id: string) {
  const c = await enterable(db, id, ctx);
  const state = contestState(c, ctx.now);
  const qs = state === "upcoming" ? [] : await db.select().from(questions).where(inArray(questions.id, c.problemIds));
  const { rows, subs, frozen } = await board(db, c, ctx.now, { frozen: true });
  const shown = rows.slice(0, BOARD_ROWS);
  const me = rows.find((r) => r.userId === ctx.userId);
  if (me && !shown.includes(me)) shown.push(me);
  const who = await names(db, c, shown.map((r) => r.userId));
  const mySubs = subs.filter((s) => s.userId === ctx.userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    byPlayCode: c.tenantId === null,
    state,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    freezeMinutes: c.freezeMinutes,
    problems: c.problemIds.map((pid, i) => {
      const q = qs.find((x) => x.id === pid);
      const mine = mySubs.filter((s) => s.questionId === pid);
      return {
        letter: LETTERS[i]!,
        id: pid,
        question: q ? toStudentView(toCoreQuestion(q), c.id) : null,
        solved: mine.some((s) => s.verdict === "accepted"),
        tries: mine.length,
      };
    }),
    submissions: mySubs.slice(0, 50).map((s) => ({ id: s.id, letter: LETTERS[c.problemIds.indexOf(s.questionId)]!, verdict: s.verdict, passed: s.passed, total: s.total, at: s.createdAt })),
    scoreboard: {
      frozen,
      participants: rows.length,
      rows: shown.map((r) => ({ ...r, ...who.get(r.userId)!, me: r.userId === ctx.userId, userId: undefined })),
    },
  };
}

export async function submitToContest(db: Db, ctx: Ctx, id: string, input: { questionId: string; response: StudentResponse }) {
  const c = await enterable(db, id, ctx);
  const state = contestState(c, ctx.now);
  if (state === "upcoming") throw badRequest("The contest hasn't started");
  if (state === "ended") throw badRequest("The contest has ended");
  if (!c.problemIds.includes(input.questionId)) throw notFound("Problem");
  await rateLimit(`contest:${c.id}:${ctx.userId}`, SUBMITS_PER_MINUTE, 60_000, ctx.now, "Too many submissions; wait a moment");
  const [q] = await db.select().from(questions).where(eq(questions.id, input.questionId));
  const evaluation = await evaluate(toCoreQuestion(q!), input.response, "assessment");
  // The contest may have ended while the code ran; it was submitted in time.
  const verdict = verdictOf(evaluation);
  const [row] = await db
    .insert(contestSubmissions)
    .values({
      contestId: c.id,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      questionId: input.questionId,
      response: input.response,
      verdict,
      passed: evaluation.kind === "code" ? evaluation.passed : evaluation.correct ? 1 : 0,
      total: evaluation.kind === "code" ? evaluation.total : 1,
      createdAt: ctx.now,
    })
    .returning();
  // Hidden tests stay hidden: the verdict and the count passed, plus any compile error.
  return {
    id: row!.id,
    verdict,
    passed: row!.passed,
    total: row!.total,
    compileError: evaluation.kind === "code" && evaluation.compileError ? evaluation.compileError.slice(0, 2000) : null,
  };
}

/** The Run button: sample tests only, nothing recorded. */
export async function runInContest(db: Db, ctx: Ctx, id: string, input: { questionId: string; response: StudentResponse }) {
  const c = await enterable(db, id, ctx);
  if (contestState(c, ctx.now) === "upcoming") throw badRequest("The contest hasn't started");
  if (!c.problemIds.includes(input.questionId)) throw notFound("Problem");
  await checkRunRate(ctx.userId, ctx.now);
  const [q] = await db.select().from(questions).where(eq(questions.id, input.questionId));
  return tryRun(toCoreQuestion(q!), input.response);
}

// ---------- Staff ----------

/** Contests a college's staff see: their own, and PlayCode's that include the college. */
export async function staffContests(db: Db, tenantId: string | null, now: Date) {
  const rows = await db
    .select()
    .from(contests)
    .where(tenantId ? or(eq(contests.tenantId, tenantId), and(isNull(contests.tenantId), sql`${contests.audienceIds} ? ${tenantId}`)) : isNull(contests.tenantId))
    .orderBy(desc(contests.startsAt))
    .limit(100);
  const counts = rows.length
    ? await db
        .select({ contestId: contestSubmissions.contestId, people: sql<number>`count(distinct ${contestSubmissions.userId})::int`, submissions: sql<number>`count(*)::int` })
        .from(contestSubmissions)
        .where(inArray(contestSubmissions.contestId, rows.map((r) => r.id)))
        .groupBy(contestSubmissions.contestId)
    : [];
  return {
    contests: rows.map((c) => ({
      id: c.id,
      title: c.title,
      byPlayCode: c.tenantId === null,
      editable: c.tenantId === tenantId,
      state: contestState(c, now),
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      problems: c.problemIds.length,
      participants: counts.find((x) => x.contestId === c.id)?.people ?? 0,
      submissions: counts.find((x) => x.contestId === c.id)?.submissions ?? 0,
    })),
  };
}

async function staffContest(db: DbOrTx, tenantId: string | null, id: string) {
  const c = await loadContest(db, id);
  const ok = tenantId ? c.tenantId === tenantId || (c.tenantId === null && c.audienceIds.includes(tenantId)) : c.tenantId === null;
  if (!ok) throw notFound("Contest");
  return c;
}

/**
 * The live, unfrozen scoreboard for staff. In a PlayCode contest a college
 * sees full names only for its own students.
 */
export async function staffContestView(db: Db, tenantId: string | null, id: string, now: Date) {
  const c = await staffContest(db, tenantId, id);
  const { rows, subs } = await board(db, c, now, { frozen: false });
  const people = rows.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo, tenantId: users.tenantId, college: tenants.name }).from(users).leftJoin(tenants, eq(tenants.id, users.tenantId)).where(inArray(users.id, rows.map((r) => r.userId))) : [];
  const qs = await db.select({ id: questions.id, title: questions.body }).from(questions).where(inArray(questions.id, c.problemIds));
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    byPlayCode: c.tenantId === null,
    state: contestState(c, now),
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    freezeMinutes: c.freezeMinutes,
    problems: c.problemIds.map((pid, i) => {
      const forP = subs.filter((s) => s.questionId === pid);
      return {
        letter: LETTERS[i]!,
        id: pid,
        stem: qs.find((q) => q.id === pid)?.title.stem ?? pid,
        solvedBy: new Set(forP.filter((s) => s.verdict === "accepted").map((s) => s.userId)).size,
        submissions: forP.length,
      };
    }),
    scoreboard: rows.map((r) => {
      const p = people.find((x) => x.id === r.userId);
      const own = !tenantId || p?.tenantId === tenantId;
      return { ...r, userId: own ? r.userId : null, name: own ? p?.name ?? "" : (p?.name.split(/\s+/)[0] ?? ""), rollNo: own ? p?.rollNo ?? null : null, college: c.tenantId ? null : p?.college ?? null };
    }),
  };
}

/** After the contest: pairs of accepted solutions to the same problem that look copied. Own students only for a college. */
export async function contestSimilarity(db: Db, tenantId: string | null, id: string, now: Date) {
  const c = await staffContest(db, tenantId, id);
  if (contestState(c, now) !== "ended") throw conflict("contest_running", "The similarity check runs once the contest has ended");
  const subs = await db
    .select({ sub: contestSubmissions, name: users.name, rollNo: users.rollNo })
    .from(contestSubmissions)
    .innerJoin(users, eq(users.id, contestSubmissions.userId))
    .where(and(eq(contestSubmissions.contestId, c.id), eq(contestSubmissions.verdict, "accepted"), tenantId ? eq(contestSubmissions.tenantId, tenantId) : undefined))
    .orderBy(desc(contestSubmissions.createdAt));
  const pairs: { letter: string; a: { name: string; rollNo: string | null }; b: { name: string; rollNo: string | null }; similarityPct: number }[] = [];
  for (const [i, pid] of c.problemIds.entries()) {
    // Each student's last accepted solution to this problem.
    const latest = new Map<string, (typeof subs)[number]>();
    for (const s of subs) if (s.sub.questionId === pid && s.sub.response.kind === "code" && !latest.has(s.sub.userId)) latest.set(s.sub.userId, s);
    const list = [...latest.values()];
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = list[x]!;
        const b = list[y]!;
        if (a.sub.response.kind !== "code" || b.sub.response.kind !== "code") continue;
        const sim = codeSimilarity(a.sub.response.source, b.sub.response.source);
        if (sim >= SIMILARITY_FLAG) pairs.push({ letter: LETTERS[i]!, a: { name: a.name, rollNo: a.rollNo }, b: { name: b.name, rollNo: b.rollNo }, similarityPct: Math.round(sim * 100) });
      }
    }
  }
  return { pairs: pairs.sort((p, q) => q.similarityPct - p.similarityPct) };
}

/** Problems a contest can use: live coding and SQL questions from the global bank and (for a college) its own. */
export async function contestProblems(db: Db, tenantId: string | null) {
  const rows = await db
    .select({ id: questions.id, type: questions.type, skillId: questions.skillId, difficulty: questions.difficulty, body: questions.body })
    .from(questions)
    .where(and(eq(questions.status, "live"), inArray(questions.type, ["write_code", "sql_query"]), tenantId ? or(isNull(questions.tenantId), eq(questions.tenantId, tenantId)) : isNull(questions.tenantId)));
  return { problems: rows.map((r) => ({ id: r.id, type: r.type, skillId: r.skillId, difficulty: r.difficulty, stem: r.body.stem })) };
}

export function assertCollegeContestScope(tenantId: string | null) {
  if (!tenantId) throw forbidden("Sign in to a college to run its contests");
}
