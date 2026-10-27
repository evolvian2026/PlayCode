"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatLpa, type CompanyType } from "@playcode/core";
import { Icon } from "@/components/Icon";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { startAndOpen } from "@/lib/start";

interface Drive {
  id: string;
  company: string;
  companyType: CompanyType;
  roleTitle: string;
  description: string;
  ctcRupees: number;
  location: string;
  driveDate: string;
  registerBy: string;
  rounds: string[];
  pack: { id: string; title: string } | null;
  open: boolean;
  eligibility: { eligible: boolean; reasons: string[] };
  application: { status: "registered" | "shortlisted" | "rejected" | "offered"; roundsCleared: number; offerCtcRupees: number | null } | null;
}

interface Placements {
  record: { cgpa: number | null; backlogs: number | null; tenthPct: number | null; twelfthPct: number | null; graduationYear: number | null } | null;
  attendance: { sessions: number; attended: number; pct: number | null };
  drives: Drive[];
}

function Rounds({ drive }: { drive: Drive }) {
  const t = useT();
  const app = drive.application!;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {drive.rounds.map((r, i) => {
        const done = app.roundsCleared > i;
        const failed = app.status === "rejected" && app.roundsCleared === i;
        return (
          <div key={i} className="row small" style={{ gap: 8 }}>
            <span className={`path-dot ${done ? "done" : failed ? "locked" : i === app.roundsCleared ? "current" : "locked"}`} aria-hidden>
              {done ? <Icon name="check" size={14} /> : null}
            </span>
            <span style={{ fontWeight: i === app.roundsCleared && app.status !== "rejected" && app.status !== "offered" ? 700 : 400 }}>{r}</span>
            {done && <span className="muted">{t("cleared")}</span>}
            {failed && <span style={{ color: "var(--bad-ink)" }}>{t("not selected")}</span>}
          </div>
        );
      })}
    </div>
  );
}

function DriveCard({ drive, onChange }: { drive: Drive; onChange: (p: Placements) => void }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fmt = (d: Date) => d.toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" });
  const app = drive.application;

  async function call(action: "register" | "withdraw") {
    if (action === "withdraw" && !window.confirm(t("Withdraw your registration?"))) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api<Placements>(`/student/placements/${drive.id}/${action}`, { body: {} }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (!drive.pack) return;
    setBusy(true);
    setError(await startAndOpen({ kind: "pack", packId: drive.pack.id }, router.push));
    setBusy(false);
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.125rem" }}>{drive.company}</div>
          <div className="small">{drive.roleTitle}</div>
          <div className="small muted">
            {formatLpa(drive.ctcRupees)}
            {drive.location && ` · ${drive.location}`} · {t("drive on {date}", { date: fmt(new Date(`${drive.driveDate}T00:00:00`)) })}
          </div>
        </div>
        {app?.status === "offered" ? (
          <span className="pill good">{t("Offer")}</span>
        ) : app?.status === "rejected" ? (
          <span className="pill">{t("Closed")}</span>
        ) : app ? (
          <span className="pill accent">{t("Registered")}</span>
        ) : drive.eligibility.eligible ? (
          <span className="pill good">{t("Eligible")}</span>
        ) : (
          <span className="pill">{t("Not eligible")}</span>
        )}
      </div>
      {app?.status === "offered" && (
        <div className="small" style={{ fontWeight: 600 }}>
          {t("Congratulations! Offer of {ctc}.", { ctc: formatLpa(app.offerCtcRupees ?? drive.ctcRupees) })}
        </div>
      )}
      {app ? (
        <Rounds drive={drive} />
      ) : drive.eligibility.eligible ? (
        <div className="small muted">{t("Register by {date}. Rounds: {rounds}.", { date: fmt(new Date(drive.registerBy)), rounds: drive.rounds.join(", ") })}</div>
      ) : (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {drive.eligibility.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {drive.description && !app && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{drive.description}</p>}
      {error && <ErrorBox message={error} />}
      <div className="row wrap">
        {!app && drive.open && drive.eligibility.eligible && (
          <button className="btn primary small" disabled={busy} onClick={() => call("register")}>
            {t("Register")}
          </button>
        )}
        {(app?.status === "registered" || app?.status === "shortlisted") && drive.pack && (
          <button className="btn primary small" disabled={busy} onClick={prepare}>
            {t("Prepare: {mission}", { mission: drive.pack.title })}
          </button>
        )}
        {!app && drive.eligibility.eligible && drive.pack && (
          <button className="btn small" disabled={busy} onClick={prepare}>
            {t("Practise the mission")}
          </button>
        )}
        {(app?.status === "registered" || app?.status === "shortlisted") && (
          <Link className="btn small" href={`/play/interview?track=${drive.companyType === "product" ? "product" : "service"}`}>
            {t("Mock interview")}
          </Link>
        )}
        {app?.status === "registered" && drive.open && (
          <button className="btn ghost small" disabled={busy} onClick={() => call("withdraw")}>
            {t("Withdraw")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function StudentPlacements() {
  const t = useT();
  const { data, error, loading, reload, setData } = useApi<Placements>("/student/placements");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const open = data.drives.filter((d) => !d.application);
  const mine = data.drives.filter((d) => d.application);
  const r = data.record;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Placements")}</h1>
      <div className="card tight small">
        {r ? (
          <span>
            {t("Your record")}: CGPA {r.cgpa ?? "-"} · {t("backlogs")} {r.backlogs ?? "-"} · {t("class 10")} {r.tenthPct ?? "-"}% · {t("class 12")} {r.twelfthPct ?? "-"}%
            {r.graduationYear ? ` · ${r.graduationYear}` : ""}
          </span>
        ) : (
          <span className="muted">{t("Your academic record is not on file yet. The placement cell adds it.")}</span>
        )}
        {data.attendance.pct !== null && (
          <div>
            {t("Training attendance")}: {data.attendance.pct}% ({t("{attended} of {held} sessions", { attended: data.attendance.attended, held: data.attendance.sessions })})
          </div>
        )}
        <div className="muted">{t("Something wrong? Tell your placement cell.")}</div>
      </div>
      {mine.length > 0 && (
        <>
          <h2 style={{ margin: "8px 0 0" }}>{t("My applications")}</h2>
          {mine.map((d) => (
            <DriveCard key={d.id} drive={d} onChange={setData} />
          ))}
        </>
      )}
      <h2 style={{ margin: "8px 0 0" }}>{t("Open drives")}</h2>
      {open.length === 0 ? (
        <div className="card muted">{t("No drives open right now. Keep practising: your readiness score is what companies' tests measure.")}</div>
      ) : (
        open.map((d) => <DriveCard key={d.id} drive={d} onChange={setData} />)
      )}
    </div>
  );
}
