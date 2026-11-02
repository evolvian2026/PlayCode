"use client";

import type { DrillMatch } from "@playcode/core";
import { useT } from "@/lib/i18n";

/** A sentence or script with the words that weren't heard struck through. */
export function MatchedWords({ words }: { words: DrillMatch["words"] }) {
  const t = useT();
  return (
    <span>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          {w.heard ? (
            w.word
          ) : (
            <span style={{ color: "var(--bad-ink)", textDecoration: "line-through" }}>
              {w.word}
              <span className="sr-only"> {t("(missed)")}</span>
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

