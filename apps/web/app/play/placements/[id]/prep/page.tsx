"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { DrivePrepStep } from "@playcode/core";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import { startAndOpen } from "@/lib/start";

interface Plan {
  drive: { id: string; company: string; roleTitle: string; companyType: string; driveDate: string; rounds: string[]; packId: string | null; packTitle: string | null; minAptitude: number | null };
  daysLeft: number;
  steps: { key: DrivePrepStep; label: string; detail: string; done: boolean }[];
  done: number;
  total: number;
  aptitude: number | null;
  experiences: number;
}

/** A student's plan for one drive they registered for: each step, done or not, and where to do it. */
export default function DrivePrepPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Plan>(`/student/placements/${id}/prep`);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const d = data.drive;
  const when = new Date(`${d.driveDate}T00:00:00`).toLocaleDateString(intlLocale(locale), { weekday: "long", day: "numeric", month: "long" });
  const action = (key: DrivePrepStep) => {
    switch (key) {
      case "mission":
        return d.packId ? (
          <button className="btn small" onClick={async () => setMsg(await startAndOpen({ kind: "pack", packId: d.packId! }, router.push))}>
            {t("Practise: {mission}", { mission: d.packTitle ?? "" })}
          </button>
        ) : null;
      case "interview":
        return (
          <Link className="btn small" href={`/play/interview?track=${d.companyType === "product" ? "product" : "service"}&drive=${d.id}`}>
            {t("Start a mock interview")}
          </Link>
        );
      case "aptitude":
        return (
          <Link className="btn small" href="/play/aptitude">
            {t("Aptitude")}
          </Link>
        );
      case "profile":
        return (
          <Link className="btn small" href="/play/resume">
            {t("Go to your resume")}
          </Link>
        );
      case "documents":
        return (
          <Link className="btn small" href="/play/documents">
            {t("Upload")}
          </Link>
        );
      case "on_duty":
        return (
          <Link className="btn small" href="/play/on-duty">
            {t("Ask for on duty")}
          </Link>
        );
    }
  };
  return (
    <div className="stack">
      <Link href="/play/placements" className="small">
        ← {t("Placements")}
      </Link>
      <div>
        <h1 style={{ margin: 0 }}>{t("Your plan for {company}", { company: d.company })}</h1>
        <div className="small muted">
          {d.roleTitle} · {when} ·{" "}
          <b style={{ color: data.daysLeft <= 3 ? "var(--bad-ink)" : undefined }}>
            {data.daysLeft === 0 ? t("today") : data.daysLeft === 1 ? t("tomorrow") : t("in {n} days", { n: data.daysLeft })}
          </b>
        </div>
      </div>
      <div className="card stack" style={{ gap: 6 }}>
        <b>{data.done === data.total ? t("All done. Good luck!") : t("{done} of {total} done", { done: data.done, total: data.total })}</b>
        <Bar value={data.total ? (data.done / data.total) * 100 : 100} tone={data.done === data.total ? "good" : undefined} label={t("{done} of {total} done", { done: data.done, total: data.total })} />
        <div className="small muted">{t("Rounds: {rounds}", { rounds: d.rounds.join(", ") })}</div>
      </div>
      {msg && <ErrorBox message={msg} />}
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {data.steps.map((s) => (
          <li key={s.key} className="card row" style={{ gap: 10, alignItems: "flex-start", borderColor: s.done ? "var(--good)" : undefined }}>
            <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1, color: s.done ? "var(--good-ink)" : "var(--muted)" }}>
              {s.done ? "✓" : "○"}
            </span>
            <div className="stack" style={{ gap: 4, flex: 1 }}>
              <b>
                <span className="sr-only">{t(s.done ? "Done:" : "To do:")} </span>
                {t(s.label)}
              </b>
              <span className="small muted">{t(s.detail)}</span>
              {s.key === "aptitude" && d.minAptitude !== null && (
                <span className="small">{data.aptitude === null ? t("Needs {score}", { score: d.minAptitude }) + " · " + t("No official score yet") : t("Needs {score}", { score: d.minAptitude }) + " · " + t("Your official score, {score}", { score: data.aptitude })}</span>
              )}
              {!s.done && <div>{action(s.key)}</div>}
            </div>
          </li>
        ))}
      </ul>
      {data.experiences > 0 && (
        <Link href={`/play/experiences?company=${encodeURIComponent(d.company)}`} className="card spread" style={{ color: "inherit" }}>
          <span>
            <b>{t("Interview experiences ({n})", { n: data.experiences })}</b>
            <span className="small muted"> · {t("What seniors faced in each round of past drives, checked by the placement cell.")}</span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
