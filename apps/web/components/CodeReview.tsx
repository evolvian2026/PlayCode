"use client";

import { useState } from "react";
import { CodeBlock } from "./CodeBlock";
import { ErrorBox } from "./ui";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Review {
  summary: string;
  timeComplexity: string;
  spaceComplexity: string;
  betterApproach: string | null;
  edgeCases: string[];
  readability: string[];
  improvedCode: string;
}

/** After accepted code: an interviewer-style review on request. */
export function CodeReview({ sessionId, questionId }: { sessionId: string; questionId: string }) {
  const t = useT();
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      setReview((await api<{ review: Review }>(`/student/sessions/${sessionId}/questions/${encodeURIComponent(questionId)}/review`, { body: {} })).review);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!review) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={ask}>
          {busy ? t("Reviewing your code...") : t("Review my code")}
        </button>
        {error && <ErrorBox message={error} />}
      </div>
    );
  }
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <b className="small">{title}</b>
        <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className="card stack" aria-label={t("Code review")} style={{ background: "var(--accent-soft)", borderColor: "transparent" }}>
      <b>{t("Code review")}</b>
      <p className="small" style={{ margin: 0 }}>
        {review.summary}
      </p>
      <div className="row wrap small" style={{ gap: 12 }}>
        <span>
          {t("Time")}: <code className="inline-code">{review.timeComplexity}</code>
        </span>
        <span>
          {t("Space")}: <code className="inline-code">{review.spaceComplexity}</code>
        </span>
      </div>
      {review.betterApproach && (
        <div className="small">
          <b>{t("A better approach")}:</b> {review.betterApproach}
        </div>
      )}
      {list(t("Edge cases an interviewer would ask about"), review.edgeCases)}
      {list(t("Readability"), review.readability)}
      <details>
        <summary className="small" style={{ fontWeight: 600 }}>
          {t("A cleaner version")}
        </summary>
        <CodeBlock code={review.improvedCode} label={t("A cleaner version")} />
      </details>
    </section>
  );
}
