"use client";

import Link from "next/link";
import { useState } from "react";
import type { StudentResponse } from "@playcode/core";
import { CodeBlock } from "@/components/CodeBlock";
import { ErrorBox, Loading, timeAgo } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

type Status = "open" | "answered" | "closed";

interface Doubt {
  id: string;
  student: { id: string; name: string; rollNo: string | null };
  question: { id: string; type: string; stem: string; code: string | null; options: { id: string; text: string }[] | null; correctAnswer: string; explanation: string };
  lastAnswer: { response: StudentResponse; correct: boolean } | null;
  text: string;
  status: Status;
  answer: string | null;
  shared: boolean;
  createdAt: string;
}

/** What the student answered, in words. */
function describe(d: Doubt): string {
  const r = d.lastAnswer?.response;
  if (!r) return "-";
  switch (r.kind) {
    case "option":
      return d.question.options?.find((o) => o.id === r.optionId)?.text ?? r.optionId;
    case "text":
      return r.value;
    case "lines":
      return `Line ${r.lines.join(", ")}`;
    case "order":
      return r.ids.join(", ");
    case "code":
      return r.source;
    case "sql":
      return r.query;
  }
}

function DoubtCard({ d, onDone }: { d: Doubt; onDone: () => void }) {
  const [answer, setAnswer] = useState(d.answer ?? "");
  const [shared, setShared] = useState(d.status === "open" ? true : d.shared);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = d.question.type === "write_code" || d.question.type === "sql_query";

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(`/console/doubts/${d.id}/${path}`, { body: body ?? {} });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <article className="card stack" aria-labelledby={`doubt-${d.id}`}>
      <div className="spread wrap">
        <h2 id={`doubt-${d.id}`} style={{ margin: 0, fontSize: "1rem" }}>
          <Link href={`/console/students/${d.student.id}`}>{d.student.name}</Link> <span className="muted small">{d.student.rollNo}</span>
        </h2>
        <span className="small muted">{timeAgo(d.createdAt)}</span>
      </div>
      <blockquote style={{ margin: 0, paddingLeft: 12, borderLeft: "3px solid var(--accent)" }}>{d.text}</blockquote>
      <details>
        <summary className="small" style={{ fontWeight: 600 }}>
          The question ({d.question.id})
        </summary>
        <div className="stack small" style={{ marginTop: 8 }}>
          <div style={{ whiteSpace: "pre-line" }}>{d.question.stem}</div>
          {d.question.code && <CodeBlock code={d.question.code} />}
          <div>
            <b>They answered:</b>{" "}
            <span style={{ color: d.lastAnswer?.correct ? "var(--good-ink)" : "var(--bad-ink)", whiteSpace: "pre-wrap", fontFamily: code ? "var(--mono)" : undefined }}>{describe(d)}</span>
          </div>
          <div>
            <b>Correct answer:</b> <span style={{ whiteSpace: "pre-wrap", fontFamily: code ? "var(--mono)" : undefined }}>{d.question.correctAnswer}</span>
          </div>
          <div className="muted">{d.question.explanation}</div>
        </div>
      </details>
      {d.status === "closed" ? (
        <div className="small muted">Closed without an answer.</div>
      ) : (
        <>
          <div>
            <label htmlFor={`answer-${d.id}`}>Your answer</label>
            <textarea id={`answer-${d.id}`} rows={3} maxLength={3000} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </div>
          <label className="row small" style={{ gap: 6, margin: 0 }}>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} style={{ width: "auto" }} />
            Show this answer to other students who answer the question (without names)
          </label>
          {error && <ErrorBox message={error} />}
          <div className="row">
            <button className="btn primary" disabled={busy || answer.trim().length < 2} onClick={() => act("answer", { answer, shared })}>
              {d.status === "answered" ? "Update answer" : "Send answer"}
            </button>
            {d.status === "open" && (
              <button className="btn ghost" disabled={busy} onClick={() => act("close")}>
                Close without answering
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}

export default function ConsoleDoubts() {
  const [status, setStatus] = useState<Status>("open");
  const { data, error, loading, reload } = useApi<{ doubts: Doubt[] }>(`/console/doubts?status=${status}`);
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 860 }}>
      <div>
        <h1 style={{ margin: 0 }}>Doubts</h1>
        <p className="muted" style={{ margin: 0 }}>
          Questions your students asked after answering a question, oldest first. Answers reach them as a notification.
        </p>
      </div>
      <div className="row" role="group" aria-label="Show">
        {(["open", "answered", "closed"] as const).map((s) => (
          <button key={s} className={`btn small ${status === s ? "primary" : ""}`} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === "open" ? "Waiting" : s === "answered" ? "Answered" : "Closed"}
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data?.doubts.length === 0 ? (
        <div className="card muted">{status === "open" ? "No doubts waiting. Nice." : "Nothing here yet."}</div>
      ) : (
        data?.doubts.map((d) => <DoubtCard key={d.id} d={d} onDone={reload} />)
      )}
    </div>
  );
}
