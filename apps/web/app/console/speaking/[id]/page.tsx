"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { JAM_CATEGORIES, JAM_DIMENSIONS, type JamDelivery, type JamTopic } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Detail {
  userId: string;
  student: { name: string; rollNo: string | null };
  topic: JamTopic;
  transcript: string;
  delivery: JamDelivery;
  spokenMs: number;
  feedback: { scores: Record<string, number>; overall: number; strengths: string[]; improvements: string[]; betterOpening: string; outline: string[] };
  createdAt: string;
}

export default function ConsoleSpeakingAttempt() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Detail>(`/console/jam/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const f = data.feedback;
  const d = data.delivery;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <Link href="/console/speaking" className="small muted">
          Speaking practice
        </Link>
        <h1 style={{ margin: 0 }}>
          <Link href={`/console/students/${data.userId}`} style={{ color: "inherit" }}>
            {data.student.name}
          </Link>{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            · {data.topic.topic}
          </span>
        </h1>
        <div className="small muted">
          {JAM_CATEGORIES[data.topic.category]} · {new Date(data.createdAt).toLocaleString("en-IN")} · {d.words} words in {Math.round(data.spokenMs / 1000)} seconds
        </div>
      </div>
      <div className="card stack">
        <div className="row wrap">
          <span className="pill accent">Overall {f.overall}/5</span>
          <span className="small">{JAM_DIMENSIONS.map(([key, label]) => `${label} ${f.scores[key] ?? "-"}`).join(" · ")}</span>
        </div>
        <div className="small">
          Delivery: {d.wpm} words a minute ({d.pace}) · {d.fillersPer100Words} fillers per 100 words · {d.usedPct}% of the minute used
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {(
            [
              ["Strengths", f.strengths],
              ["To work on", f.improvements],
              ["Points the talk could make", f.outline],
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
        {f.betterOpening && (
          <div className="small">
            <b>A stronger opening:</b> <i>{f.betterOpening}</i>
          </div>
        )}
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>What they said</h2>
        <p className="muted small" style={{ margin: 0 }}>
          As the student&apos;s browser transcribed it: punctuation is missing and some words may be misheard.
        </p>
        <div style={{ whiteSpace: "pre-wrap" }}>{data.transcript}</div>
      </div>
    </div>
  );
}
