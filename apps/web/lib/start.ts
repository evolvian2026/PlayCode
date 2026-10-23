"use client";

import { api, errorMessage } from "./api";
import type { SessionView } from "./types";

export type StartInput =
  | { kind: "skill"; skillId: string }
  | { kind: "daily" }
  | { kind: "pack"; packId: string }
  | { kind: "assignment"; assignmentId: string }
  | { kind: "mistakes" }
  | { kind: "review" };

/** Start (or resume) a session and open the player. Returns an error message on failure. */
export async function startAndOpen(input: StartInput, push: (href: string) => void): Promise<string | null> {
  try {
    const session = await api<SessionView>("/student/sessions", { body: input });
    push(`/play/session/${session.id}`);
    return null;
  } catch (e) {
    return errorMessage(e);
  }
}
