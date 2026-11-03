"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { WRITING_DIMENSIONS, WRITING_KINDS, type WritingTask } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Detail {
  userId: string;
  student: { name: string; rollNo: string | null };
  task: WritingTask;
  text: string;
  words: number;
  timeMs: number;
  feedback: { scores: Record<string, number>; overall: number; pointsCovered: number[]; strengths: string[]; improvements: string[]; corrections: { original: string; better: string; why: string }[]; improved: string };
  createdAt: string;
}

export default function ConsoleWritingAttempt() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Detail>(`/console/writing/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const f = data.feedback;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <Link href="/console/writing" className="small muted">
          Written English
        </Link>
        <h1 style={{ margin: 0 }}>
          <Link href={`/console/students/${data.userId}`} style={{ color: "inherit" }}>
            {data.student.name}
          </Link>{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            · {WRITING_KINDS[data.task.kind]}: {data.task.title}
          </span>
        </h1>
        <div className="small muted">
          {new Date(data.createdAt).toLocaleString("en-IN")} · {data.words} words in {Math.round(data.timeMs / 60_000)} min (limit {data.task.minWords}-{data.task.maxWords} words, {data.task.minutes} min)
        </div>
      </div>
      <div className="card stack">
        <div className="row wrap">
          <span className="pill accent">Overall {f.overall}/5</span>
          <span className="small">{WRITING_DIMENSIONS.map(([key, label]) => `${label} ${f.scores[key] ?? "-"}`).join(" · ")}</span>
        </div>
        <p className="small" style={{ margin: 0 }}>
          {data.task.prompt}
        </p>
        {data.task.points.length > 0 && (
          <div className="small">
            Points covered: {data.task.points.map((p, i) => `${f.pointsCovered.includes(i) ? "✓" : "✗"} ${p}`).join(" · ")}
          </div>
        )}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {(
            [
              ["Strengths", f.strengths],
              ["To work on", f.improvements],
            ] as const
          ).map(([title, items]) => (
            <div key={title}>
              <b className="small">{title}</b>
              <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {items.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {f.corrections.length > 0 && (
          <div>
            <b className="small">Corrections</b>
            <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {f.corrections.map((c) => (
                <li key={c.original}>
                  <s>{c.original}</s> → <b>{c.better}</b> <span className="muted">({c.why})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>What they wrote</h2>
          <div style={{ whiteSpace: "pre-wrap" }}>{data.text}</div>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Corrected version</h2>
          <div style={{ whiteSpace: "pre-wrap" }}>{f.improved}</div>
        </div>
      </div>
    </div>
  );
}
