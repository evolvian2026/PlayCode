import { and, desc, eq, inArray } from "drizzle-orm";
import { describeAnswer, QUESTION_TYPE_LABELS } from "@playcode/core";
import type { Db } from "../db/client";
import { paperResults, questionPapers, questions, skills, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { printedSet, type PaperSet } from "./papers";
import { descendants, scopedUnitIds, studentIdsInUnits, tenantUnits, type AuthContext } from "./scope";

// Results of class tests taken on paper. The teacher types each student's
// answers in the order of the student's set (an option letter, y or n for a
// written answer they marked, - for blank) and PlayCode marks them against
// that set's key. Staff get the class's distribution and how each question
// and skill went; students see their marks with every question, their answer,
// the right one and the explanation. Like mock tests, paper results don't feed
// mastery or readiness: they inform the student and staff.

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
type Question = typeof questions.$inferSelect;
type Outcome = "right" | "wrong" | "blank";

export interface KeyItem {
  questionId: string;
  /** "option": the teacher types the letter the student chose; "mark": y or n after marking a written answer. */
  kind: "option" | "mark";
  options: number;
  expect: string;
}

/** The key for one set, in the set's printed order. */
export function setKey(paperId: string, qs: Question[], set: PaperSet): KeyItem[] {
  return printedSet(paperId, qs, set).map((p) => {
    const a = p.q.answer;
    if (a.kind === "option") return { questionId: p.q.id, kind: "option", options: p.options.length, expect: LETTERS[p.options.findIndex((o) => o.id === a.optionId)]! };
    return { questionId: p.q.id, kind: "mark", options: 0, expect: "y" };
  });
}

/** Mark typed answers against a set's key. Spaces and commas are ignored; case doesn't matter. */
export function markAnswers(key: KeyItem[], typed: string) {
  const answers = typed.toLowerCase().replace(/[\s,]/g, "");
  if (answers.length !== key.length) throw badRequest(`Type one character for each of the ${key.length} questions (you typed ${answers.length}); use - for a blank`);
  const outcomes: Record<string, Outcome> = {};
  let right = 0;
  key.forEach((k, i) => {
    const c = answers[i]!;
    const allowed = k.kind === "option" ? LETTERS.slice(0, k.options) : "yn";
    if (c !== "-" && !allowed.includes(c)) {
      throw badRequest(`Question ${i + 1}: "${c}" isn't allowed; use ${k.kind === "option" ? `a to ${LETTERS[k.options - 1]}` : "y (right) or n (wrong)"}, or - for blank`);
    }
    const outcome: Outcome = c === "-" ? "blank" : c === k.expect ? "right" : "wrong";
    if (outcome === "right") right++;
    outcomes[k.questionId] = outcome;
  });
  return { answers, outcomes, right };
}

async function loadPaper(db: Db, tenantId: string, id: string) {
  const [paper] = await db.select().from(questionPapers).where(and(eq(questionPapers.id, id), eq(questionPapers.tenantId, tenantId)));
  if (!paper) throw notFound("Paper");
  const rows = await db.select().from(questions).where(inArray(questions.id, paper.questionIds));
  const byId = new Map(rows.map((q) => [q.id, q]));
  return { paper, qs: paper.questionIds.flatMap((qid) => byId.get(qid) ?? []) };
}

/** Students of a unit (and below) that the staff member may see. */
async function studentsOf(db: Db, auth: AuthContext, unitId?: string) {
  const tenantId = auth.tenantId!;
  const scoped = await scopedUnitIds(db, auth);
  if (unitId && !scoped.includes(unitId)) throw forbidden("That batch or section is outside your scope");
  return studentIdsInUnits(db, tenantId, unitId ? descendants(await tenantUnits(db, tenantId), [unitId]) : scoped);
}

/** The marks entry sheet for one section: each student with what has been entered so far. */
export async function resultsSheet(db: Db, auth: AuthContext, paperId: string, unitId: string) {
  const { paper, qs } = await loadPaper(db, auth.tenantId!, paperId);
  const ids = await studentsOf(db, auth, unitId);
  const people = ids.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)) : [];
  const results = ids.length ? await db.select().from(paperResults).where(and(eq(paperResults.paperId, paper.id), inArray(paperResults.userId, ids))) : [];
  const byUser = new Map(results.map((r) => [r.userId, r]));
  // The key comes along so the sheet can check rows and show scores as the teacher types; staff can print it anyway.
  const format = (set: PaperSet) => setKey(paper.id, qs, set).map(({ kind, options, expect }) => ({ kind, options, expect }));
  return {
    paper: { id: paper.id, title: paper.title, sets: paper.sets, questions: qs.length, marks: qs.length * paper.marksPerQuestion, marksPerQuestion: paper.marksPerQuestion },
    format: { A: format("A"), ...(paper.sets > 1 ? { B: format("B") } : {}) },
    students: people
      .sort((a, b) => (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }))
      .map((p) => {
        const r = byUser.get(p.id);
        return { ...p, result: r ? { set: r.set, answers: r.answers, score: r.score } : null };
      }),
  };
}

/** Save typed answers for several students. Valid rows are saved; the others come back with what's wrong. An empty answer clears a result. */
export async function saveResults(db: Db, auth: AuthContext, paperId: string, entries: { userId: string; set: PaperSet; answers: string }[], now: Date) {
  const { paper, qs } = await loadPaper(db, auth.tenantId!, paperId);
  const allowed = new Set(await studentsOf(db, auth));
  const keys: Partial<Record<PaperSet, KeyItem[]>> = {};
  const keyFor = (set: PaperSet) => (keys[set] ??= setKey(paper.id, qs, set));
  const errors: { userId: string; message: string }[] = [];
  const notify: string[] = [];
  let saved = 0;
  for (const e of entries) {
    if (!allowed.has(e.userId)) {
      errors.push({ userId: e.userId, message: "This student isn't in your batches or sections" });
      continue;
    }
    if (e.set === "B" && paper.sets < 2) {
      errors.push({ userId: e.userId, message: "This paper has one set" });
      continue;
    }
    if (!e.answers.trim()) {
      await db.delete(paperResults).where(and(eq(paperResults.paperId, paper.id), eq(paperResults.userId, e.userId)));
      continue;
    }
    let marked;
    try {
      marked = markAnswers(keyFor(e.set), e.answers);
    } catch (err) {
      errors.push({ userId: e.userId, message: (err as Error).message });
      continue;
    }
    const values = { set: e.set, answers: marked.answers, outcomes: marked.outcomes, score: marked.right * paper.marksPerQuestion, enteredBy: auth.userId, enteredAt: now };
    await db
      .insert(paperResults)
      .values({ tenantId: paper.tenantId, paperId: paper.id, userId: e.userId, ...values })
      .onConflictDoUpdate({ target: [paperResults.paperId, paperResults.userId], set: values });
    saved++;
    notify.push(e.userId);
  }
  // One message per student per paper, so it names no score: a corrected entry doesn't notify again.
  await enqueue(
    db,
    notify.map((userId) => ({
      tenantId: paper.tenantId,
      userId,
      template: "class_test" as const,
      title: `Class test result: ${paper.title}`,
      body: "Your marks are in. See each question, your answer and the right one.",
      link: appLink("/play/class-tests"),
      dedupeKey: `class-test:${paper.id}:${userId}`,
      sentBy: auth.userId,
    })),
  );
  if (notify.length) void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: paper.tenantId, actorId: auth.userId, action: "paper.results", target: paper.id, data: { saved, errors: errors.length } });
  return { saved, errors };
}

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

/** How the class did: score distribution, and each question and skill by the share who got it right. */
export async function paperReport(db: Db, auth: AuthContext, paperId: string, unitId?: string) {
  const { paper, qs } = await loadPaper(db, auth.tenantId!, paperId);
  const ids = await studentsOf(db, auth, unitId);
  const rows = ids.length
    ? await db
        .select({ r: paperResults, name: users.name, rollNo: users.rollNo })
        .from(paperResults)
        .innerJoin(users, eq(users.id, paperResults.userId))
        .where(and(eq(paperResults.paperId, paper.id), inArray(paperResults.userId, ids)))
    : [];
  const marks = qs.length * paper.marksPerQuestion;
  const skillNames = new Map((await db.select({ id: skills.id, name: skills.name, topic: skills.topicName }).from(skills)).map((s) => [s.id, `${s.topic}: ${s.name}`]));
  const perQuestion = qs.map((q, i) => {
    const got = rows.map((x) => x.r.outcomes[q.id]).filter(Boolean);
    return { n: i + 1, id: q.id, stem: q.body.stem.length > 140 ? `${q.body.stem.slice(0, 139)}…` : q.body.stem, skill: skillNames.get(q.skillId) ?? q.skillId, skillId: q.skillId, rightPct: pct(got.filter((o) => o === "right").length, got.length), blankPct: pct(got.filter((o) => o === "blank").length, got.length) };
  });
  const bySkill = new Map<string, { right: number; total: number; questions: number }>();
  for (const q of qs) {
    const s = bySkill.get(q.skillId) ?? { right: 0, total: 0, questions: 0 };
    s.questions++;
    for (const x of rows) {
      s.total++;
      if (x.r.outcomes[q.id] === "right") s.right++;
    }
    bySkill.set(q.skillId, s);
  }
  const scores = rows.map((x) => x.r.score);
  return {
    paper: { id: paper.id, title: paper.title, questions: qs.length, marks },
    students: ids.length,
    entered: rows.length,
    average: rows.length ? Math.round((scores.reduce((a, b) => a + b, 0) / rows.length) * 10) / 10 : null,
    highest: rows.length ? Math.max(...scores) : null,
    lowest: rows.length ? Math.min(...scores) : null,
    // Five bands of 20%: 0-19, 20-39, 40-59, 60-79, 80-100.
    distribution: [0, 1, 2, 3, 4].map((b) => rows.filter((x) => Math.min(4, Math.floor((pct(x.r.score, marks) / 100) * 5)) === b).length),
    questions: perQuestion,
    skills: [...bySkill].map(([id, s]) => ({ id, name: skillNames.get(id) ?? id, questions: s.questions, rightPct: pct(s.right, s.total) })).sort((a, b) => a.rightPct - b.rightPct),
    results: rows.map((x) => ({ userId: x.r.userId, name: x.name, rollNo: x.rollNo, set: x.r.set, score: x.r.score, pct: pct(x.r.score, marks) })).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)),
  };
}

// ---------- Students ----------

export async function myClassTests(db: Db, userId: string) {
  const rows = await db
    .select({ r: paperResults, paper: questionPapers })
    .from(paperResults)
    .innerJoin(questionPapers, eq(questionPapers.id, paperResults.paperId))
    .where(eq(paperResults.userId, userId))
    .orderBy(desc(paperResults.enteredAt))
    .limit(50);
  return {
    tests: rows.map(({ r, paper }) => {
      const marks = paper.questionIds.length * paper.marksPerQuestion;
      return { id: r.id, title: paper.title, score: r.score, marks, pct: pct(r.score, marks), enteredAt: r.enteredAt };
    }),
  };
}

/** One result with every question as printed in the student's set: their answer, the right one, and why. */
export async function myClassTest(db: Db, userId: string, id: string) {
  const [r] = await db.select().from(paperResults).where(and(eq(paperResults.id, id), eq(paperResults.userId, userId)));
  if (!r) throw notFound("Class test");
  const { paper, qs } = await loadPaper(db, r.tenantId, r.paperId);
  const marks = qs.length * paper.marksPerQuestion;
  const classScores = (await db.select({ score: paperResults.score }).from(paperResults).where(eq(paperResults.paperId, paper.id))).map((x) => x.score);
  const skillNames = new Map((await db.select({ id: skills.id, name: skills.name }).from(skills)).map((s) => [s.id, s.name]));
  const items = printedSet(paper.id, qs, r.set).map((p, i) => {
    const typed = r.answers[i] ?? "-";
    const optionIndex = LETTERS.indexOf(typed);
    return {
      n: i + 1,
      type: QUESTION_TYPE_LABELS[p.q.type],
      skill: skillNames.get(p.q.skillId) ?? p.q.skillId,
      stem: p.q.body.stem,
      code: p.q.body.code ?? null,
      outcome: r.outcomes[p.q.id] ?? "blank",
      yourAnswer: p.q.answer.kind === "option" && optionIndex >= 0 ? (p.options[optionIndex]?.text ?? null) : null,
      correctAnswer: describeAnswer(p.q),
      explanation: p.q.explanation,
    };
  });
  return {
    id: r.id,
    title: paper.title,
    set: paper.sets > 1 ? r.set : null,
    score: r.score,
    marks,
    // Only an aggregate, once a few classmates have results, so no one's mark can be worked out.
    classAverage: classScores.length >= 5 ? Math.round((classScores.reduce((a, b) => a + b, 0) / classScores.length) * 10) / 10 : null,
    enteredAt: r.enteredAt,
    items,
  };
}
