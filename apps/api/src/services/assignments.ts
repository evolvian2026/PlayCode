import { and, eq, inArray } from "drizzle-orm";
import { hashString, shuffle } from "@playcode/core";
import type { Db } from "../db/client";
import { assignments, packs, questions } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { visibleTo } from "./practice";

export interface NewAssignment {
  title: string;
  packId?: string;
  skillIds?: string[];
  count: number;
  unitIds: string[];
  openAt: Date;
  closeAt: Date;
}

/** Create an assignment from a mission pack or from skills (everyone gets the same questions). */
export async function createAssignment(db: Db, args: NewAssignment & { tenantId: string; actorId: string }) {
  let questionIds: string[];
  if (args.packId) {
    const [pack] = await db.select().from(packs).where(eq(packs.id, args.packId));
    if (!pack || (pack.tenantId && pack.tenantId !== args.tenantId)) throw notFound("Pack");
    questionIds = pack.questionIds;
  } else {
    const pool = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(visibleTo(args.tenantId), inArray(questions.skillId, args.skillIds ?? [])))
      .orderBy(questions.difficulty, questions.id);
    if (pool.length === 0) throw badRequest("Those skills have no questions yet");
    questionIds = shuffle(pool.map((p) => p.id), hashString(`${args.title}:${args.openAt.toISOString()}`)).slice(0, args.count);
  }
  const [created] = await db
    .insert(assignments)
    .values({
      tenantId: args.tenantId,
      title: args.title,
      packId: args.packId ?? null,
      questionIds,
      orgUnitIds: args.unitIds,
      openAt: args.openAt,
      closeAt: args.closeAt,
      createdBy: args.actorId,
    })
    .returning();
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "assignment.create", target: created!.id, data: { title: args.title, questions: questionIds.length } });
  return created!;
}
