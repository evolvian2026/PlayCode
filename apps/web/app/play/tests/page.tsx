"use client";

import Link from "next/link";
import { ErrorBox, formatDate, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { TestListItem } from "@/lib/types";


const STATE: Record<TestListItem["state"], [string, string]> = {
  upcoming: ["Upcoming", ""],
  open: ["Open now", "accent"],
  in_progress: ["In progress", "warn"],
  submitted: ["Submitted", "good"],
  missed: ["Missed", "bad"],
};

export default function Tests() {
  const { data, error, loading, reload } = useApi<{ assessments: TestListItem[] }>("/student/assessments");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  return (
    <div className="stack">
      <div>
        <h1>Tests</h1>
        <p className="muted">Timed, proctored tests from your institution. Your answers save as you go.</p>
      </div>
      {data.assessments.length === 0 && <div className="card">No tests scheduled for you.</div>}
      {data.assessments.map((a) => (
        <div key={a.id} className="card stack" style={{ gap: 6 }}>
          <div className="spread">
            <h2 style={{ margin: 0 }}>{a.title}</h2>
            <span className={`pill ${STATE[a.state][1]}`}>{STATE[a.state][0]}</span>
          </div>
          <div className="muted small">
            {a.questionCount} questions · {a.durationMinutes} min · {a.proctorLevel === 2 ? "camera and full screen" : "full screen recommended"}
          </div>
          <div className="muted small">
            {formatDate(a.openAt)} to {formatDate(a.closeAt)}
          </div>
          {a.score !== null && (
            <div style={{ fontWeight: 700 }}>
              Score: {a.score} / {a.maxScore}
            </div>
          )}
          {(a.state === "open" || a.state === "in_progress" || a.state === "submitted") && (
            <Link href={`/play/tests/${a.id}`} className={`btn ${a.state === "submitted" ? "" : "primary"}`}>
              {a.state === "open" ? "Start" : a.state === "in_progress" ? "Resume" : "View"}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
