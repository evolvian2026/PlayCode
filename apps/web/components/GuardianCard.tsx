"use client";

import { useState, type FormEvent } from "react";
import { GUARDIAN_RELATIONS, monthLabel, type GuardianRelation } from "@playcode/core";
import { ErrorBox } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface State {
  enabled: boolean;
  emailConfigured: boolean;
  guardian: { name: string; relation: GuardianRelation; email: string; status: "waiting" | "active" | "stopped"; stoppedBy: "guardian" | "student" | null; lastReportMonth: string | null } | null;
}

/** A monthly progress email to a parent, if the institution allows it. Shown on Me. */
export function GuardianCard() {
  const t = useT();
  const { data, setData } = useApi<State>("/student/guardian");
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: "", relation: "father" as GuardianRelation, email: "", consent: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!data?.enabled) return null;
  const g = data.guardian;

  async function call(fn: () => Promise<State>, done?: string) {
    setBusy(true);
    setMsg(null);
    setNote(null);
    try {
      setData(await fn());
      setEditing(false);
      if (done) setNote(done);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void call(() => api<State>("/student/guardian", { method: "PUT", body: f }), t("We've emailed {name} a link to confirm.", { name: f.name }));
  }

  return (
    <div className="card stack">
      <div>
        <h2 style={{ margin: 0 }}>{t("Progress emails to a parent")}</h2>
        <div className="small muted">{t("A short email on the 1st of each month: days you practised, your placement readiness, training attendance, class tests and drives. Only if you want it.")}</div>
      </div>
      {note && (
        <div className="small" role="status" style={{ color: "var(--good-ink)" }}>
          ✓ {note}
        </div>
      )}
      {g && !editing && (
        <div className="stack" style={{ gap: 6 }}>
          <div>
            <b>{g.name}</b> <span className="small muted">({t(GUARDIAN_RELATIONS[g.relation])})</span>
            <div className="small muted" style={{ overflowWrap: "anywhere" }}>
              {g.email}
            </div>
          </div>
          <span className={`pill ${g.status === "active" ? "good" : g.status === "waiting" ? "warn" : ""}`} style={{ alignSelf: "flex-start" }}>
            {t(g.status === "active" ? "Sending monthly" : g.status === "waiting" ? "Waiting for them to confirm" : "Stopped")}
          </span>
          {g.status === "active" && g.lastReportMonth && <div className="small muted">{t("Last sent: {month}", { month: monthLabel(g.lastReportMonth) })}</div>}
          {g.status === "stopped" && g.stoppedBy === "guardian" && <div className="small muted">{t("{name} stopped these emails.", { name: g.name })}</div>}
          <div className="row wrap" style={{ gap: 6 }}>
            {g.status === "waiting" && (
              <button className="btn small" disabled={busy} onClick={() => call(() => api<State>("/student/guardian/resend", { body: {} }), t("Sent the confirmation email again."))}>
                {t("Send the link again")}
              </button>
            )}
            <button
              className="btn ghost small"
              disabled={busy}
              onClick={() => {
                setF({ name: "", relation: "father", email: "", consent: false });
                setEditing(true);
              }}
            >
              {t("Use a different address")}
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => call(() => api<State>("/student/guardian", { method: "DELETE" }))}>
              {t(g.status === "stopped" ? "Remove" : "Stop the emails")}
            </button>
          </div>
        </div>
      )}
      {(!g || editing) && (
        <form className="stack" onSubmit={submit} style={{ gap: 8 }}>
          <div className="row wrap">
            <div style={{ flex: "1 1 180px" }}>
              <label htmlFor="g-name">{t("Parent's name")}</label>
              <input id="g-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} required />
            </div>
            <div>
              <label htmlFor="g-rel">{t("Relation")}</label>
              <select id="g-rel" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value as GuardianRelation })}>
                {(Object.keys(GUARDIAN_RELATIONS) as GuardianRelation[]).map((r) => (
                  <option key={r} value={r}>
                    {t(GUARDIAN_RELATIONS[r])}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="g-email">{t("Their email address")}</label>
            <input id="g-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={200} required />
          </div>
          <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} style={{ width: "auto", marginTop: 3 }} />
            <span>{t("I agree to share my monthly progress with this person. I can stop it at any time.")}</span>
          </label>
          {!data.emailConfigured && <div className="small muted">{t("Email isn't set up on this server yet, so this can't be sent.")}</div>}
          <div className="row">
            <button className="btn primary small" disabled={busy || !f.consent || !data.emailConfigured}>
              {busy ? t("Sending...") : t("Send them a confirmation link")}
            </button>
            {editing && (
              <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
                {t("Cancel")}
              </button>
            )}
          </div>
        </form>
      )}
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}
