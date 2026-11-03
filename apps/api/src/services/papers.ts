import PDFDocument from "pdfkit";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { hashString, LANGUAGE_LABELS, QUESTION_TYPE_LABELS, shuffle, type Option, type QuestionBody } from "@playcode/core";
import type { Db } from "../db/client";
import { questionPapers, questions, skills, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { quickVisibleTo } from "./practice";
import { getTenant } from "./tenant";

// Question papers for class tests on paper: staff pick skills and how many
// questions from each, PlayCode picks them from the bank (the quick types
// that work on paper, no coding problems), and prints the paper and a
// separate answer key as PDFs. Set B has the questions and options in a
// different order, with its own key, so neighbours can't copy.

export const MAX_PAPER_QUESTIONS = 60;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

type Question = typeof questions.$inferSelect;
type Paper = typeof questionPapers.$inferSelect;
export type PaperSet = "A" | "B";

/** Skills with how many printable questions each has for this institution. */
export async function paperSkills(db: Db, tenantId: string) {
  const rows = await db.select({ skillId: questions.skillId }).from(questions).where(quickVisibleTo(tenantId));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.skillId, (counts.get(r.skillId) ?? 0) + 1);
  const all = await db.select().from(skills).orderBy(asc(skills.topic), asc(skills.id));
  return { skills: all.filter((s) => counts.has(s.id)).map((s) => ({ id: s.id, name: s.name, topic: s.topicName, available: counts.get(s.id)! })), maxQuestions: MAX_PAPER_QUESTIONS };
}

export interface PaperInput {
  title: string;
  instructions: string | null;
  durationMinutes: number;
  marksPerQuestion: number;
  sets: 1 | 2;
  picks: { skillId: string; count: number }[];
}

export async function createPaper(db: Db, auth: { tenantId: string; userId: string }, input: PaperInput, now: Date) {
  const total = input.picks.reduce((n, p) => n + p.count, 0);
  if (total === 0) throw badRequest("Choose at least one question");
  if (total > MAX_PAPER_QUESTIONS) throw badRequest(`A paper can have up to ${MAX_PAPER_QUESTIONS} questions`);
  if (new Set(input.picks.map((p) => p.skillId)).size !== input.picks.length) throw badRequest("Each skill once, please");
  const seed = hashString(`${auth.tenantId}:${input.title}:${now.toISOString()}`);
  const chosen: Question[] = [];
  for (const pick of input.picks) {
    const pool = await db.select().from(questions).where(and(quickVisibleTo(auth.tenantId), eq(questions.skillId, pick.skillId))).orderBy(asc(questions.id));
    if (pool.length < pick.count) throw badRequest(`Only ${pool.length} printable questions in ${pick.skillId}`);
    // A random pick, easier ones first within the skill.
    chosen.push(...shuffle(pool, seed + hashString(pick.skillId)).slice(0, pick.count).sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id)));
  }
  const [paper] = await db
    .insert(questionPapers)
    .values({
      tenantId: auth.tenantId,
      createdBy: auth.userId,
      title: input.title,
      instructions: input.instructions,
      durationMinutes: input.durationMinutes,
      marksPerQuestion: input.marksPerQuestion,
      sets: input.sets,
      questionIds: chosen.map((q) => q.id),
      createdAt: now,
    })
    .returning();
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "paper.create", target: paper!.id, data: { questions: total } });
  return paper!;
}

export async function listPapers(db: Db, tenantId: string) {
  const rows = await db
    .select({ paper: questionPapers, by: users.name })
    .from(questionPapers)
    .leftJoin(users, eq(users.id, questionPapers.createdBy))
    .where(eq(questionPapers.tenantId, tenantId))
    .orderBy(desc(questionPapers.createdAt))
    .limit(100);
  return { papers: rows.map(({ paper, by }) => ({ ...summary(paper), by })) };
}

const summary = (p: Paper) => ({ id: p.id, title: p.title, questions: p.questionIds.length, durationMinutes: p.durationMinutes, marks: p.questionIds.length * p.marksPerQuestion, sets: p.sets, createdAt: p.createdAt });

async function load(db: Db, tenantId: string, id: string) {
  const [paper] = await db.select().from(questionPapers).where(and(eq(questionPapers.id, id), eq(questionPapers.tenantId, tenantId)));
  if (!paper) throw notFound("Paper");
  const rows = await db.select().from(questions).where(inArray(questions.id, paper.questionIds));
  const byId = new Map(rows.map((q) => [q.id, q]));
  // A question retired since stays on the paper: it was printed that way.
  return { paper, questions: paper.questionIds.flatMap((qid) => byId.get(qid) ?? []) };
}

export async function getPaper(db: Db, tenantId: string, id: string) {
  const { paper, questions: qs } = await load(db, tenantId, id);
  return { ...summary(paper), instructions: paper.instructions, marksPerQuestion: paper.marksPerQuestion, items: qs.map((q) => ({ id: q.id, type: QUESTION_TYPE_LABELS[q.type], skillId: q.skillId, difficulty: q.difficulty, stem: q.body.stem })) };
}

export async function deletePaper(db: Db, auth: { tenantId: string; userId: string }, id: string) {
  const deleted = await db.delete(questionPapers).where(and(eq(questionPapers.id, id), eq(questionPapers.tenantId, auth.tenantId))).returning({ id: questionPapers.id });
  if (!deleted.length) throw notFound("Paper");
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "paper.delete", target: id });
}

/** One question as printed in a set: its options and Parsons lines in the set's order. */
interface Printed {
  q: Question;
  options: Option[];
  lines: { id: string; text: string }[];
}

/** The questions of a set in print order. Set A keeps the paper's order; set B reshuffles questions, options and lines. */
export function printedSet(paperId: string, qs: Question[], set: PaperSet): Printed[] {
  const seed = hashString(`${paperId}:${set}`);
  const order = set === "A" ? qs : shuffle(qs, seed);
  return order.map((q, i) => ({
    q,
    options: set === "A" ? (q.body.options ?? []) : shuffle(q.body.options ?? [], seed + i),
    lines: set === "A" ? (q.body.lines ?? []) : shuffle(q.body.lines ?? [], seed + 1000 + i),
  }));
}

/** The answer as written in the key for one printed question. */
export function keyAnswer(p: Printed): string {
  const a = p.q.answer;
  switch (a.kind) {
    case "option": {
      const i = p.options.findIndex((o) => o.id === a.optionId);
      return `(${LETTERS[i]}) ${p.options[i]?.text ?? ""}`;
    }
    case "text":
      return a.accepted.join("  or  ");
    case "lines":
      return `Line ${a.lines.join(", ")}`;
    case "order":
      return (a.orders[0] ?? []).map((id) => LETTERS[p.lines.findIndex((l) => l.id === id)]!.toUpperCase()).join(", ");
    default:
      return "";
  }
}

// The PDF's built-in fonts can't draw a few characters the bank uses.
const PDF_SAFE: [RegExp, string][] = [
  [/₹/g, "Rs "],
  [/→/g, "->"],
  [/ⁿ/g, "^n"],
  [/[≤]/g, "<="],
  [/[≥]/g, ">="],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
];
/** Stems are written for the app ("Tap the line"); on paper the student writes instead. */
export const paperWording = (stem: string) => stem.replace(/\bTap the line\b/g, "Find the line").replace(/\bType the\b/g, "Write the");

export const pdfSafe = (s: string) => PDF_SAFE.reduce((t, [re, to]) => t.replace(re, to), s).replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff·—–]/g, "?");

export async function paperPdf(db: Db, tenantId: string, id: string, set: PaperSet, kind: "paper" | "key"): Promise<Buffer> {
  const { paper, questions: qs } = await load(db, tenantId, id);
  if (set === "B" && paper.sets < 2) throw badRequest("This paper has one set");
  const tenant = await getTenant(db, tenantId);
  const printed = printedSet(paper.id, qs, set);
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `${paper.title} (${kind === "key" ? "answer key, " : ""}set ${set})`, Author: tenant.name } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ink = "#17162b";
  const muted = "#5d5b76";
  const width = doc.page.width - 96;
  const sets = paper.sets > 1 ? ` · Set ${set}` : "";

  // Header
  doc.fillColor(muted).font("Helvetica").fontSize(10).text(pdfSafe(tenant.name), { align: "center" });
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(16).text(pdfSafe(paper.title) + (kind === "key" ? " · Answer key" : ""), { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor(muted).text(`${qs.length} questions · ${qs.length * paper.marksPerQuestion} marks · ${paper.durationMinutes} minutes${sets}`, { align: "center" });
  doc.moveDown(0.8);
  if (kind === "paper") {
    doc.fillColor(ink).fontSize(10.5).text("Name: ______________________________    Roll no: ______________    Section: ________");
    doc.moveDown(0.6);
    const instructions = paper.instructions?.trim() || `Answer all questions. Each question carries ${paper.marksPerQuestion} mark${paper.marksPerQuestion > 1 ? "s" : ""}; there is no negative marking. Circle the letter of the option you choose, or write your answer on the line.`;
    doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(muted).text(pdfSafe(instructions), { width });
  }
  doc.moveTo(48, doc.y + 6).lineTo(48 + width, doc.y + 6).strokeColor("#c9c7dc").stroke();
  doc.moveDown(1);

  const ensure = (h: number) => {
    if (doc.y + h > doc.page.height - 64) doc.addPage();
  };
  const code = (text: string, numbered: boolean) => {
    const lines = pdfSafe(text).split("\n");
    const body = numbered ? lines.map((l, i) => `${String(i + 1).padStart(2)}  ${l}`).join("\n") : lines.join("\n");
    doc.font("Courier").fontSize(9);
    const h = doc.heightOfString(body, { width: width - 36 }) + 10;
    ensure(h);
    const top = doc.y;
    doc.rect(66, top, width - 18, h).fill("#f0effa");
    doc.fillColor(ink).text(body, 72, top + 5, { width: width - 36 });
    doc.x = 48;
    doc.y = top + h + 4;
  };

  printed.forEach((p, i) => {
    const b: QuestionBody = p.q.body;
    ensure(60);
    const n = `${i + 1}.`;
    if (kind === "key") {
      const a = p.q.answer;
      const codeOption = a.kind === "option" ? p.options.find((o) => o.id === a.optionId && o.code) : undefined;
      const answer = codeOption ? keyAnswer(p).split(" ")[0]! : keyAnswer(p);
      doc.fillColor(ink).font("Helvetica-Bold").fontSize(10.5).text(`${n} `, { continued: true }).font("Helvetica").text(pdfSafe(answer), { width });
      if (codeOption) code(codeOption.text, false);
      doc.fillColor(muted).font("Helvetica").fontSize(9).text(pdfSafe(p.q.explanation), 66, doc.y, { width: width - 18 });
      doc.x = 48;
      doc.moveDown(0.5);
      return;
    }
    const lang = b.language !== "theory" ? ` (${LANGUAGE_LABELS[b.language]})` : "";
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(10.5).text(`${n} `, { continued: true }).font("Helvetica").text(pdfSafe(paperWording(b.stem)) + lang, { width });
    doc.moveDown(0.3);
    if (b.code) code(b.code, p.q.type === "spot_bug");
    for (const ex of b.examples ?? []) code(`Input: ${ex.input}\nOutput: ${ex.output}`, false);
    if (p.lines.length) {
      code(p.lines.map((l, j) => `(${LETTERS[j]!.toUpperCase()}) ${l.text}`).join("\n"), false);
      doc.font("Helvetica").fontSize(9.5).fillColor(muted).text("Write the letters in the right order, leaving out lines that don't belong:", 66);
      doc.fillColor(ink).text("______________________________", 66);
    }
    p.options.forEach((o, j) => {
      ensure(18);
      const label = `(${LETTERS[j]}) `;
      if (o.code) {
        doc.font("Helvetica").fontSize(10).fillColor(ink).text(label, 66);
        code(o.text, false);
      } else {
        doc.font("Helvetica").fontSize(10).fillColor(ink).text(label + pdfSafe(o.text), 66, doc.y, { width: width - 18 });
      }
    });
    if (p.q.answer.kind === "text") doc.font("Helvetica").fontSize(10).fillColor(ink).text(`Answer: ${b.inputHint ? `(${pdfSafe(b.inputHint)}) ` : ""}______________________________`, 66);
    if (p.q.answer.kind === "lines") doc.font("Helvetica").fontSize(10).fillColor(ink).text("Faulty line number(s): ____________", 66);
    doc.x = 48;
    doc.moveDown(0.8);
  });

  // Page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // the footer sits below the text area
    doc.font("Helvetica").fontSize(8).fillColor(muted).text(`${pdfSafe(paper.title)}${sets} · page ${i + 1} of ${range.count}`, 48, doc.page.height - 36, { width, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}
