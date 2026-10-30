"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatLpa, localDate, OUTCOME_KINDS, QUALIFYING_EXAMS, type OutcomeKind } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

type Status = "pending" | "verified" | "rejected";
interface Outcome {
  id: string;
  kind: OutcomeKind;
  kindLabel: string;
  organisation: string;
  detail: string;
  ctcRupees: number | null;
  outcomeDate: string;
  status: Status;
  reviewNote: string | null;
}
interface Mine {
  outcomes: Outcome[];
  campusOffers: { company: string; roleTitle: string; ctcRupees: number | null; driveDate: string }[];
}

const STATUS: Record<Status, [string, string]> = { pending: ["With the placement cell", "warn"], verified: ["Verified", "good"], rejected: ["Needs more", "bad"] };

function OutcomeForm({ initial, onSaved, onCancel }: { initial?: Outcome; onSaved: () => void; onCancel: () => void }) {
  const t = useT();
  const today = localDate(new Date());
  const [kind, setKind] = useState<OutcomeKind>(initial?.kind ?? "job");
  const [organisation, setOrganisation] = useState(initial?.organisation ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [lpa, setLpa] = useState(initial?.ctcRupees ? String(initial.ctcRupees / 100_000) : "");
  const [date, setDate] = useState(initial?.outcomeDate ?? today);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const labels = OUTCOME_KINDS[kind];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body = { kind, organisation, detail, outcomeDate: date, ctcRupees: kind === "job" && lpa ? Math.round(Number(lpa) * 100_000) : null };
      await api(initial ? `/student/outcomes/${initial.id}` : "/student/outcomes", { method: initial ? "PUT" : "POST", body });
      onSaved();
    } catch (err) {
      setMsg(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t(initial ? "Change your report" : "Tell your placement cell")}</h2>
      <div>
        <label htmlFor="o-kind">{t("What happened?")}</label>
        <select id="o-kind" value={kind} onChange={(e) => setKind(e.target.value as OutcomeKind)}>
          {(Object.keys(OUTCOME_KINDS) as OutcomeKind[]).map((k) => (
            <option key={k} value={k}>
              {t(OUTCOME_KINDS[k].label)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="o-org">{t(labels.organisation)}</label>
        {kind === "exam" ? (
          <select id="o-org" value={organisation} onChange={(e) => setOrganisation(e.target.value)} required>
            <option value="">{t("Choose the exam")}</option>
            {QUALIFYING_EXAMS.map((x) => (
              <option key={x} value={x}>
                {t(x)}
              </option>
            ))}
          </select>
        ) : (
          <input id="o-org" value={organisation} onChange={(e) => setOrganisation(e.target.value)} maxLength={160} required />
        )}
      </div>
      <div>
        <label htmlFor="o-detail">{t(labels.detail)}</label>
        <input id="o-detail" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={300} />
      </div>
      <div className="row wrap">
        {kind === "job" && (
          <div>
            <label htmlFor="o-ctc">{t("CTC in lakhs per year")}</label>
            <input id="o-ctc" type="number" inputMode="decimal" min={0.1} step={0.01} value={lpa} onChange={(e) => setLpa(e.target.value)} required style={{ maxWidth: 160 }} />
          </div>
        )}
        <div>
          <label htmlFor="o-date">{t(kind === "exam" ? "Result date" : kind === "startup" ? "Started on" : "Date of the letter")}</label>
          <input id="o-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
      </div>
      <div className="small muted">{t("Show the offer letter, admission letter or scorecard to your placement cell. It counts in your batch's results once they've seen it.")}</div>
      {initial?.status === "verified" && <div className="small">{t("This is verified. Changing it sends it back to your placement cell to check again.")}</div>}
      {msg && <ErrorBox message={msg} />}
      <div className="row wrap">
        <button className="btn primary" disabled={busy}>
          {busy ? t("Sending...") : t(initial ? "Send the update" : "Send to the placement cell")}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

export default function OutcomesPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload } = useApi<Mine>("/student/outcomes");
  const [editing, setEditing] = useState<Outcome | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short", year: "numeric" });

  async function remove(o: Outcome) {
    if (!window.confirm(t("Withdraw this report?"))) return;
    setMsg(null);
    try {
      await api(`/student/outcomes/${o.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <div>
        <Link href="/play/placements" className="small muted">
          ← {t("Placements")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{t("Offers and admissions")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Offers from campus drives are already on record. Tell your placement cell about anything else: an offer you found yourself, an admission for higher studies, a qualifying exam or a company you've started.")}
        </p>
      </div>
      {editing ? (
        <OutcomeForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      ) : (
        <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => setEditing("new")}>
          {t("Add an offer or admission")}
        </button>
      )}
      {msg && <ErrorBox message={msg} />}
      {data.campusOffers.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t("Campus offers")}</h2>
          {data.campusOffers.map((o) => (
            <div key={`${o.company}-${o.driveDate}`} className="spread" style={{ gap: 8 }}>
              <div>
                <b>{o.company}</b>
                <div className="small muted">
                  {o.roleTitle}
                  {o.ctcRupees ? ` · ${formatLpa(o.ctcRupees)}` : ""}
                </div>
              </div>
              <span className="pill good">{t("On record")}</span>
            </div>
          ))}
        </div>
      )}
      {data.outcomes.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t("Your reports")}</h2>
          {data.outcomes.map((o) => {
            const [label, tone] = STATUS[o.status];
            return (
              <div key={o.id} className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div className="spread wrap" style={{ gap: 8 }}>
                  <div>
                    <b>{o.organisation}</b>
                    <div className="small muted">
                      {t(o.kindLabel)}
                      {o.detail ? ` · ${o.detail}` : ""}
                      {o.ctcRupees ? ` · ${formatLpa(o.ctcRupees)}` : ""} · {fmt(o.outcomeDate)}
                    </div>
                  </div>
                  <span className={`pill ${tone}`}>{t(label)}</span>
                </div>
                {o.status === "rejected" && o.reviewNote && (
                  <div className="small" style={{ color: "var(--bad-ink)" }}>
                    {t("From the placement cell:")} {o.reviewNote}
                  </div>
                )}
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn small" onClick={() => setEditing(o)}>
                    {t("Edit")}
                  </button>
                  {o.status !== "verified" && (
                    <button className="btn ghost small" onClick={() => remove(o)}>
                      {t("Withdraw")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
