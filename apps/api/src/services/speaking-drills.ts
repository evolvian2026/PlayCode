import { and, desc, eq, inArray } from "drizzle-orm";
import { DRILL_KINDS, DRILL_LENGTH, DRILL_SENTENCES, drillScore, matchDrill, type DrillKind } from "@playcode/core";
import type { Db } from "../db/client";
import { speakingDrills, users } from "../db/schema";
import { badRequest, notFound } from "../lib/errors";

// Read-aloud and listen-and-repeat drills. The page picks the sentences from
// the core bank and sends back what the browser heard for each; the score is
// worked out here from the bank, so a sitting can't claim its own accuracy.
// No AI is involved, so the drills are open to every plan.

type Ctx = { tenantId: string; userId: string; now: Date };

const sentence = (id: string) => DRILL_SENTENCES.find((s) => s.id === id);

export async function drillsHome(db: Db, ctx: Ctx) {
  const rows = await db.select().from(speakingDrills).where(eq(speakingDrills.userId, ctx.userId)).orderBy(desc(speakingDrills.createdAt)).limit(30);
  const best = (kind: DrillKind) => rows.filter((r) => r.kind === kind).reduce<number | null>((b, r) => Math.max(b ?? 0, r.accuracy), null);
  return {
    kinds: (Object.keys(DRILL_KINDS) as DrillKind[]).map((kind) => ({ kind, best: best(kind), sittings: rows.filter((r) => r.kind === kind).length })),
    sittings: rows.map((r) => ({ id: r.id, kind: r.kind, accuracy: r.accuracy, wpm: r.wpm, sentences: r.items.length, createdAt: r.createdAt })),
  };
}

const view = (row: typeof speakingDrills.$inferSelect) => ({
  id: row.id,
  kind: row.kind,
  accuracy: row.accuracy,
  wpm: row.wpm,
  createdAt: row.createdAt,
  items: row.items.map((i) => {
    const text = sentence(i.sentenceId)?.text ?? "";
    return { ...i, text, words: matchDrill(text, i.heard).words };
  }),
});

export async function getMyDrill(db: Db, ctx: Ctx, id: string) {
  const [row] = await db.select().from(speakingDrills).where(and(eq(speakingDrills.id, id), eq(speakingDrills.userId, ctx.userId)));
  if (!row) throw notFound("Drill");
  return view(row);
}

export async function submitDrill(db: Db, ctx: Ctx, input: { kind: DrillKind; items: { sentenceId: string; heard: string; spokenMs: number }[] }) {
  if (new Set(input.items.map((i) => i.sentenceId)).size !== input.items.length) throw badRequest("Each sentence counts once");
  const items = input.items.map((i) => {
    const s = sentence(i.sentenceId);
    if (!s) throw badRequest("Unknown sentence");
    return { sentenceId: s.id, heard: i.heard.trim(), spokenMs: i.spokenMs, accuracy: matchDrill(s.text, i.heard).accuracy };
  });
  if (items.length > DRILL_LENGTH) throw badRequest(`A sitting has at most ${DRILL_LENGTH} sentences`);
  const score = drillScore(input.kind, items);
  const [row] = await db
    .insert(speakingDrills)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, kind: input.kind, items, accuracy: score.accuracy, wpm: score.wpm, createdAt: ctx.now })
    .returning();
  return view(row!);
}

/** Drill results for the given students: each student's latest and best by kind, for teachers. */
export async function drillsFor(db: Db, studentIds: string[]) {
  if (studentIds.length === 0) return { students: [], averages: null };
  const rows = await db
    .select({ userId: speakingDrills.userId, name: users.name, rollNo: users.rollNo, kind: speakingDrills.kind, accuracy: speakingDrills.accuracy, wpm: speakingDrills.wpm, createdAt: speakingDrills.createdAt })
    .from(speakingDrills)
    .innerJoin(users, eq(users.id, speakingDrills.userId))
    .where(inArray(speakingDrills.userId, studentIds))
    .orderBy(desc(speakingDrills.createdAt))
    .limit(2000);
  const byStudent = new Map<string, { userId: string; name: string; rollNo: string | null; sittings: number; lastAt: Date } & Record<DrillKind, { latest: number; best: number } | null>>();
  for (const r of rows) {
    const s = byStudent.get(r.userId) ?? byStudent.set(r.userId, { userId: r.userId, name: r.name, rollNo: r.rollNo, sittings: 0, lastAt: r.createdAt, read: null, repeat: null }).get(r.userId)!;
    s.sittings++;
    // Rows are newest first, so the first of a kind is the latest.
    const k = s[r.kind];
    s[r.kind] = k ? { latest: k.latest, best: Math.max(k.best, r.accuracy) } : { latest: r.accuracy, best: r.accuracy };
  }
  const students = [...byStudent.values()];
  const mean = (kind: DrillKind) => {
    const xs = students.map((s) => s[kind]?.latest).filter((x): x is number => x !== undefined);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  return { students, averages: students.length ? { students: students.length, sittings: rows.length, read: mean("read"), repeat: mean("repeat") } : null };
}
