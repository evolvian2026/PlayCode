"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { interviewDimensions, type InterviewTrack } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Detail {
  userId: string;
  student: { name: string; rollNo: string | null };
  track: InterviewTrack;
  mode: "text" | "voice";
  status: string;
  focusSkills: { id: string; name: string }[];
  turns: { role: "interviewer" | "candidate"; text: string; voice?: { wpm: number; fillers: number; edited: boolean } }[];
  scorecard: {
    scores: Record<string, number>;
    prepare?: string[];
    overall: number;
    strengths: string[];
    improvements: string[];
    summary: string;
    practise: { id: string; name: string }[];
    delivery?: { spokenAnswers: number; wordsPerMinute: number; fillersPer100Words: number; pace: string; tips: string[] } | null;
  } | null;
  startedAt: string;
}

export default function ConsoleInterview() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Detail>(`/console/interviews/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const c = data.scorecard;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <Link href="/console/interviews" className="small muted">
          Mock interviews
        </Link>
        <h1 style={{ margin: 0 }}>
          <Link href={`/console/students/${data.userId}`} style={{ color: "inherit" }}>
            {data.student.name}
          </Link>{" "}
          <span className="muted" style={{ fontWeight: 500 }}>· {data.track === "hr" ? "HR interview" : `${data.track} company interview`}{data.mode === "voice" ? ", spoken" : ""}</span>
        </h1>
        <div className="small muted">
          {new Date(data.startedAt).toLocaleString("en-IN")}
          {data.focusSkills.length > 0 && ` · focus: ${data.focusSkills.map((s) => s.name).join(", ")}`}
        </div>
      </div>
      {c && (
        <div className="card stack">
          <div className="row wrap">
            <span className="pill accent">Overall {c.overall}/5</span>
            <span className="small">
              {interviewDimensions(data.track)
                .map(([key, label]) => `${label} ${c.scores[key] ?? "-"}`)
                .join(" · ")}
            </span>
          </div>
          <p style={{ margin: 0 }}>{c.summary}</p>
          {c.prepare && c.prepare.length > 0 && <div className="small">Questions to prepare: {c.prepare.join(" · ")}</div>}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div>
              <b className="small">Strengths</b>
              <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {c.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <b className="small">To work on</b>
              <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {c.improvements.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          {c.delivery && (
            <div className="small">
              <b>Delivery</b> ({c.delivery.spokenAnswers} spoken answers): {c.delivery.wordsPerMinute} words a minute, {c.delivery.fillersPer100Words} filler words per 100. {c.delivery.tips.join(" ")}
            </div>
          )}
          {c.practise.length > 0 && <div className="small muted">Suggested practice: {c.practise.map((s) => s.name).join(", ")}</div>}
          <div className="small muted">Scored by AI from the transcript below. Use it as a starting point for a conversation, not a grade.</div>
        </div>
      )}
      <div className="card stack" style={{ gap: 10 }}>
        <h2 style={{ margin: 0 }}>Transcript</h2>
        {data.turns.map((t, i) => (
          <div key={i} style={{ whiteSpace: "pre-wrap" }}>
            <b className="small">{t.role === "interviewer" ? "Interviewer" : data.student.name}:</b> {t.text}
            {t.voice && (
              <span className="small muted">
                {" "}
                (spoken, {t.voice.wpm} wpm{t.voice.edited ? ", transcript edited" : ""})
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
