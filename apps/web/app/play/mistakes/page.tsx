"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LANGUAGE_LABELS, QUESTION_TYPE_LABELS, type Language, type QuestionType } from "@playcode/core";
import { ErrorBox, Loading, timeAgo } from "@/components/ui";
import { useApi } from "@/lib/api";
import { startAndOpen } from "@/lib/start";

interface Mistakes {
  mistakes: { questionId: string; wrongCount: number; lastWrongAt: string; stem: string; type: QuestionType; language: string }[];
}

export default function MistakesPage() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Mistakes>("/student/mistakes");
  const [startError, setStartError] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  return (
    <div className="stack">
      <div>
        <h1>Mistake notebook</h1>
        <p className="muted">Every question you got wrong lands here. Answer it right to clear it and earn a heart.</p>
      </div>
      {startError && <ErrorBox message={startError} />}
      {data.mistakes.length === 0 ? (
        <div className="card">Nothing to review. Nice work!</div>
      ) : (
        <>
          <button className="btn primary big" onClick={async () => setStartError(await startAndOpen({ kind: "mistakes" }, router.push))}>
            Review {Math.min(10, data.mistakes.length)} mistakes
          </button>
          {data.mistakes.map((m) => (
            <div key={m.questionId} className="card tight">
              <div style={{ fontWeight: 600 }}>{m.stem}</div>
              <div className="muted small">
                {QUESTION_TYPE_LABELS[m.type]} · {LANGUAGE_LABELS[m.language as Language] ?? m.language} · wrong {m.wrongCount}× · {timeAgo(m.lastWrongAt)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
