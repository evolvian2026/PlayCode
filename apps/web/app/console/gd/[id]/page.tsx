"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { GD_DIMENSIONS, type GdParticipation, type GdSpeaker } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Detail {
  userId: string;
  student: { name: string; rollNo: string | null };
  topic: { title: string };
  status: string;
  turns: { speaker: GdSpeaker; name: string; text: string; summary?: boolean }[];
  scorecard: { scores: Record<string, number>; overall: number; strengths: string[]; improvements: string[]; summary: string; missedPoints: string[]; participation: GdParticipation } | null;
  startedAt: string;
}

export default function ConsoleGd() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Detail>(`/console/gd/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const c = data.scorecard;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <Link href="/console/gd" className="small muted">
          Group discussions
        </Link>
        <h1 style={{ margin: 0 }}>
          <Link href={`/console/students/${data.userId}`} style={{ color: "inherit" }}>
            {data.student.name}
          </Link>{" "}
          <span className="muted" style={{ fontWeight: 500 }}>· {data.topic.title}</span>
        </h1>
        <div className="small muted">{new Date(data.startedAt).toLocaleString("en-IN")}</div>
      </div>
      {c && (
        <div className="card stack">
          <div className="row wrap">
            <span className="pill accent">Overall {c.overall}/5</span>
            <span className="small">{GD_DIMENSIONS.map(([key, label]) => `${label} ${c.scores[key] ?? "-"}`).join(" · ")}</span>
          </div>
          <div className="small muted">
            Spoke {c.participation.contributions} times, {c.participation.sharePct}% of the words · {c.participation.initiated ? "opened the discussion" : "didn't open"} ·{" "}
            {c.participation.summarised ? "gave the summary" : "no summary"}
          </div>
          <p style={{ margin: 0 }}>{c.summary}</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {(
              [
                ["Strengths", c.strengths],
                ["To work on", c.improvements],
                ["Points they could have made", c.missedPoints],
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
        </div>
      )}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Discussion</h2>
        {data.turns.map((t, i) => (
          <div key={i} style={t.speaker === "student" ? { borderLeft: "3px solid var(--accent)", paddingLeft: 10 } : { paddingLeft: 13 }}>
            <b className="small">
              {t.name}
              {t.summary ? " (summary)" : ""}
            </b>
            <div style={{ whiteSpace: "pre-wrap" }}>{t.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
