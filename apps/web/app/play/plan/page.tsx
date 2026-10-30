"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import { startFor, type PlanDayView, type StudyPlan } from "@/lib/plan";
import { startAndOpen } from "@/lib/start";

const STATUS_TONE: Record<PlanDayView["status"], string> = { done: "good", missed: "bad", today: "accent", upcoming: "" };
const STATUS_LABEL: Record<PlanDayView["status"], string> = { done: "Done", missed: "Missed", today: "Today", upcoming: "" };

function NewPlan({ onMade }: { onMade: (p: StudyPlan) => void }) {
  const t = useT();
  const placements = useApi<{ drives: { id: string; company: string; driveDate: string; application: unknown; eligibility: { eligible: boolean } }[] }>("/student/placements");
  const today = new Date().toISOString().slice(0, 10);
  const drives = (placements.data?.drives ?? []).filter((d) => d.driveDate > today && (d.application || d.eligibility.eligible));
  const [driveId, setDriveId] = useState("");
  const [date, setDate] = useState("");
  const [profile, setProfile] = useState<"service" | "product">("service");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onMade((await api<{ plan: StudyPlan }>("/student/plan", { body: driveId ? { driveId } : { targetDate: date, profile } })).plan);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={make}>
      <p className="small" style={{ margin: 0 }}>
        {t("Pick what you're preparing for. PlayCode plans one short task a day from your weakest skills for that kind of company, with a review each week and a mock round the day before.")}
      </p>
      {drives.length > 0 && (
        <div>
          <label htmlFor="plan-drive">{t("A placement drive")}</label>
          <select id="plan-drive" value={driveId} onChange={(e) => setDriveId(e.target.value)}>
            <option value="">{t("No drive: choose a date")}</option>
            {drives.map((d) => (
              <option key={d.id} value={d.id}>
                {d.company} · {d.driveDate}
              </option>
            ))}
          </select>
        </div>
      )}
      {!driveId && (
        <div className="row wrap">
          <div>
            <label htmlFor="plan-date">{t("Test date")}</label>
            <input id="plan-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="plan-profile">{t("Kind of company")}</label>
            <select id="plan-profile" value={profile} onChange={(e) => setProfile(e.target.value as "service" | "product")}>
              <option value="service">{t("Service companies")}</option>
              <option value="product">{t("Product companies")}</option>
            </select>
          </div>
        </div>
      )}
      {error && <ErrorBox message={error} />}
      <button className="btn primary" disabled={busy} style={{ alignSelf: "flex-start" }}>
        {busy ? t("Planning...") : t("Make my plan")}
      </button>
    </form>
  );
}

export default function PlanPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { data, error, loading, reload, setData } = useApi<{ plan: StudyPlan | null }>("/student/plan");
  const [rebuilding, setRebuilding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const plan = data.plan;
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(intlLocale(locale), { weekday: "short", day: "numeric", month: "short" });

  async function remove() {
    if (!window.confirm(t("Remove your study plan?"))) return;
    setData(await api<{ plan: null }>("/student/plan", { method: "DELETE" }));
  }

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Study plan")}</h1>
      {!plan || rebuilding ? (
        <NewPlan
          onMade={(p) => {
            setRebuilding(false);
            setData({ plan: p });
          }}
        />
      ) : (
        <>
          <div className="card stack">
            <div className="spread wrap">
              <div>
                <div style={{ fontWeight: 700 }}>{plan.target.label}</div>
                <div className="small muted">
                  {fmt(plan.target.date)} · {t("{n} days to go", { n: plan.daysLeft })}
                </div>
              </div>
              <span className="small">{t("{done} of {due} days done so far", { done: plan.doneSoFar, due: plan.dueSoFar })}</span>
            </div>
            <Bar value={plan.dueSoFar ? (plan.doneSoFar / plan.dueSoFar) * 100 : 0} tone="good" label={t("Plan progress")} />
            {plan.today && (
              <div className="spread wrap">
                <div>
                  <div className="small muted">{t("Today")}</div>
                  <b>{t(plan.today.title)}</b>
                </div>
                {plan.today.status === "done" ? (
                  <span className="pill good">{t("Done")}</span>
                ) : (
                  <button className="btn primary" onClick={async () => setActionError(await startAndOpen(startFor(plan.today!), router.push))}>
                    {t("Start")}
                  </button>
                )}
              </div>
            )}
            {actionError && <ErrorBox message={actionError} />}
          </div>
          <ol className="card stack" style={{ listStyle: "none", padding: 16, margin: 0, gap: 6 }} aria-label={t("Plan days")}>
            {plan.days.map((d) => (
              <li key={d.date} className="spread small" style={{ opacity: d.status === "upcoming" ? 0.85 : 1 }}>
                <span>
                  <span className="muted" style={{ display: "inline-block", minWidth: 96 }}>
                    {fmt(d.date)}
                  </span>{" "}
                  {t(d.title)}
                </span>
                {d.status !== "upcoming" && <span className={`pill ${STATUS_TONE[d.status]}`}>{t(STATUS_LABEL[d.status])}</span>}
              </li>
            ))}
          </ol>
          <div className="row wrap">
            <button className="btn small" onClick={() => setRebuilding(true)}>
              {t("Rebuild from today")}
            </button>
            <button className="btn ghost small" onClick={remove}>
              {t("Remove plan")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
