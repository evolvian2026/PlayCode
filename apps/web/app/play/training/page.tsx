"use client";

import { useState, type FormEvent } from "react";
import { ATTENDANCE_TARGET_PCT, type TrainingKind } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

interface Session {
  id: string;
  title: string;
  kind: TrainingKind;
  kindLabel: string;
  trainer: string;
  location: string;
  startsAt: string;
  durationMinutes: number;
  status: "scheduled" | "cancelled";
  checkInOpen: boolean;
  attended: boolean;
  late: boolean;
}

interface Mine {
  attendancePct: number | null;
  held: number;
  attended: number;
  openNow: Session[];
  upcoming: Session[];
  past: Session[];
}

function CheckIn({ sessions, onDone }: { sessions: Session[]; onDone: (message: string) => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ session: { title: string }; late: boolean }>("/student/training/check-in", { body: { code: code.replace(/\s/g, "") } });
      setCode("");
      // The form goes once checked in, so the page shows the confirmation.
      onDone(t(res.late ? "You're checked in to {title}, marked late." : "You're checked in to {title}.", { title: res.session.title }));
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} style={{ borderColor: "var(--accent)" }}>
      <h2 style={{ margin: 0 }}>{t("Check in")}</h2>
      {sessions.map((s) => (
        <div key={s.id} className="small">
          <b>{s.title}</b> · {s.location}
        </div>
      ))}
      <label className="stack" style={{ gap: 4 }}>
        <span className="small">{t("Type the six-digit code on the screen")}</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="000 000"
          style={{ fontFamily: "var(--mono)", fontSize: "1.5rem", letterSpacing: "0.2em", maxWidth: 220 }}
        />
      </label>
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy || code.replace(/\s/g, "").length !== 6}>
        {busy ? t("Checking...") : t("Check in")}
      </button>
      {msg && <ErrorBox message={msg} />}
    </form>
  );
}

export default function TrainingPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload } = useApi<Mine>("/student/training");
  const [done, setDone] = useState<string | null>(null);
  const fmt = (d: string) => new Date(d).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const pct = data.attendancePct;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Training sessions")}</h1>
      {done && (
        <div className="card small" role="status" style={{ color: "var(--good-ink)", borderColor: "var(--good)" }}>
          ✓ {done}
        </div>
      )}
      {data.openNow.length > 0 && (
        <CheckIn
          sessions={data.openNow}
          onDone={(message) => {
            setDone(message);
            void reload();
          }}
        />
      )}
      <div className="card spread">
        <div>
          <div className="muted small">{t("Your attendance")}</div>
          <span className="kpi">{pct === null ? "-" : `${pct}%`}</span>
          <div className="small muted">{t("{attended} of {held} sessions", { attended: data.attended, held: data.held })}</div>
        </div>
        {pct !== null && pct < ATTENDANCE_TARGET_PCT && <span className="pill bad">{t("Below {n}%", { n: ATTENDANCE_TARGET_PCT })}</span>}
      </div>
      {pct !== null && pct < ATTENDANCE_TARGET_PCT && <div className="small muted">{t("Many companies and placement cells ask for {n}% attendance in training before you can sit drives.", { n: ATTENDANCE_TARGET_PCT })}</div>}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t("Coming up")}</h2>
        {data.upcoming.length === 0 ? (
          <div className="small muted">{t("Nothing scheduled for you yet.")}</div>
        ) : (
          data.upcoming.map((s) => (
            <div key={s.id} className="spread" style={{ gap: 8 }}>
              <div>
                <b>{s.title}</b>
                <div className="small muted">
                  {fmt(s.startsAt)} · {s.location} · {s.trainer}
                </div>
              </div>
              {s.status === "cancelled" ? (
                <span className="pill">{t("Cancelled")}</span>
              ) : s.attended ? (
                <span className={`pill ${s.late ? "warn" : "good"}`}>{t(s.late ? "Late" : "Checked in")}</span>
              ) : (
                <span className="pill">{t(s.kindLabel)}</span>
              )}
            </div>
          ))
        )}
      </div>
      {data.past.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t("Past sessions")}</h2>
          {data.past.map((s) => (
            <div key={s.id} className="spread" style={{ gap: 8 }}>
              <div>
                <b>{s.title}</b>
                <div className="small muted">{fmt(s.startsAt)}</div>
              </div>
              {s.status === "cancelled" ? (
                <span className="pill">{t("Cancelled")}</span>
              ) : s.attended ? (
                <span className={`pill ${s.late ? "warn" : "good"}`}>{t(s.late ? "Late" : "Attended")}</span>
              ) : (
                <span className="pill bad">{t("Missed")}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
