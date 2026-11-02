"use client";

import Link from "next/link";
import { ErrorBox, Loading, useDates } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { TestListItem } from "@/lib/types";
import { useT } from "@/lib/i18n";


const STATE: Record<TestListItem["state"], [string, string]> = {
  upcoming: ["Upcoming", ""],
  open: ["Open now", "accent"],
  in_progress: ["In progress", "warn"],
  submitted: ["Submitted", "good"],
  missed: ["Missed", "bad"],
};

export default function Tests() {
  const t = useT();
  const { data, error, loading, reload } = useApi<{ assessments: TestListItem[] }>("/student/assessments");
  const dates = useDates();
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  return (
    <div className="stack">
      <div>
        <h1>{t("Tests")}</h1>
        <p className="muted">{t("Timed, proctored tests from your institution. Your answers save as you go.")}</p>
      </div>
      {data.assessments.length === 0 && <div className="card">{t("No tests scheduled for you.")}</div>}
      {data.assessments.map((a) => (
        <div key={a.id} className="card stack" style={{ gap: 6 }}>
          <div className="spread">
            <h2 style={{ margin: 0 }}>{a.title}</h2>
            <span className={`pill ${STATE[a.state][1]}`}>{t(STATE[a.state][0])}</span>
          </div>
          <div className="muted small">
            {t("{n} questions", { n: a.questionCount })} · {t("{n} min", { n: a.durationMinutes })} · {t(a.proctorLevel >= 2 ? "camera and full screen" : "full screen recommended")}
          </div>
          <div className="muted small">
            {t("{from} to {to}", { from: dates.when(a.openAt), to: dates.when(a.closeAt) })}
          </div>
          {a.score !== null && (
            <div style={{ fontWeight: 700 }}>
              {t("Score: {score} / {max}", { score: a.score, max: a.maxScore ?? 0 })}
            </div>
          )}
          {(a.state === "open" || a.state === "in_progress" || a.state === "submitted") && (
            <Link href={`/play/tests/${a.id}`} className={`btn ${a.state === "submitted" ? "" : "primary"}`}>
              {t(a.state === "open" ? "Start" : a.state === "in_progress" ? "Resume" : "View")}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
