// Communication tasks: a trainer sets speaking or writing practice for batches
// with a due date (a JAM topic, a written-English task, or a read-aloud or
// repeat drill). A student's own attempt at that practice between the task
// opening and its due date counts as doing it; nothing is submitted twice.

import { JAM_TOPICS } from "./jam";
import { WRITING_TASKS } from "./writing";
import type { DrillKind } from "./speaking-drills";

export type PracticeTaskKind = "jam" | DrillKind | "writing";

export const PRACTICE_TASK_KINDS: Record<PracticeTaskKind, string> = {
  jam: "JAM talk",
  read: "Read aloud",
  repeat: "Listen and repeat",
  writing: "Written English",
};

/** Kinds marked by AI, which need the AI coach on the institution's plan. */
export const AI_PRACTICE_KINDS: PracticeTaskKind[] = ["jam", "writing"];

/** What the task is about: the JAM topic or writing task it names, or nothing for a drill. */
export function practiceTaskSubject(kind: PracticeTaskKind, ref: string | null): string | null {
  if (kind === "jam") return JAM_TOPICS.find((t) => t.id === ref)?.topic ?? null;
  if (kind === "writing") return WRITING_TASKS.find((t) => t.id === ref)?.title ?? null;
  return null;
}

/** Whether a reference fits the kind: JAM and writing name a topic or task; drills name nothing. */
export function validPracticeRef(kind: PracticeTaskKind, ref: string | null): boolean {
  return kind === "jam" || kind === "writing" ? practiceTaskSubject(kind, ref) !== null : ref === null;
}

/** Where the student does it in the app. */
export function practiceTaskPath(kind: PracticeTaskKind, ref: string | null): string {
  if (kind === "jam") return `/play/jam?topic=${ref}`;
  if (kind === "writing") return `/play/writing?task=${ref}`;
  return `/play/speaking-drills?start=${kind}`;
}
