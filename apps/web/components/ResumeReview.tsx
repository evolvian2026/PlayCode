"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

export interface Check {
  section: string;
  sectionLabel: string;
  level: "fix" | "tip";
  message: string;
}
interface Review {
  id: string;
  status: "waiting" | "reviewed";
  note: string;
  requestedAt: string;
  verdict: "ready" | "changes" | null;
  verdictLabel: string | null;
  summary: string;
  reviewedAt: string | null;
  reviewer: string | null;
  comments: { id: string; section: string; sectionLabel: string; body: string; resolved: boolean }[];
}

/** The automatic checks on the resume, and a review by staff. */
export function ResumeReview({ checks, score, onChange }: { checks: Check[]; score: number; onChange: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { data, setData } = useApi<{ review: Review | null }>("/student/resume/review");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const r = data?.review ?? null;
  const fixes = checks.filter((c) => c.level === "fix");
  async function call(path: string, body: object, method?: string) {
    setMsg(null);
    try {
      setData(await api<{ review: Review | null }>(path, { body, method }));
      setAsking(false);
      setNote("");
      onChange();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  // Ticked at once; the server catches up (and puts it back if it fails).
  async function resolve(id: string, resolved: boolean) {
    if (!r) return;
    setData({ review: { ...r, comments: r.comments.map((c) => (c.id === id ? { ...c, resolved } : c)) } });
    setMsg(null);
    try {
      setData(await api<{ review: Review | null }>(`/student/resume/review/comments/${id}`, { body: { resolved }, method: "PUT" }));
    } catch (e) {
      setData({ review: r });
      setMsg(errorMessage(e));
    }
  }
  const when = (d: string) => new Date(d).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short" });
  return (
    <section className="card stack" aria-labelledby="h-review">
      <div className="spread wrap" style={{ gap: 8 }}>
        <h2 id="h-review" style={{ margin: 0 }}>
          {t("Resume check")}
        </h2>
        <span className={`pill ${score >= 85 ? "good" : score >= 60 ? "warn" : "bad"}`}>{t("{score} / 100", { score })}</span>
      </div>
      {checks.length === 0 ? (
        <div className="small">{t("Nothing to fix. Ask for a review before you send it out.")}</div>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
          {checks.map((c) => (
            <li key={c.section + c.message} className="small row" style={{ gap: 8, alignItems: "flex-start" }}>
              <span className={`pill ${c.level === "fix" ? "bad" : ""}`} style={{ flexShrink: 0 }}>
                {t(c.level === "fix" ? "Fix" : "Tip")}
              </span>
              <span>
                <b>{t(c.sectionLabel)}:</b> {t(c.message)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }} className="stack">
        {r?.status === "waiting" ? (
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="pill accent">{t("Waiting for a review since {date}", { date: when(r.requestedAt) })}</span>
            <button className="btn ghost small" onClick={() => call("/student/resume/review/withdraw", {})}>
              {t("Withdraw")}
            </button>
          </div>
        ) : (
          <>
            {r?.status === "reviewed" && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <span className={`pill ${r.verdict === "ready" ? "good" : "warn"}`}>{t(r.verdictLabel ?? "")}</span>
                  <span className="small muted">
                    {r.reviewer} · {r.reviewedAt && when(r.reviewedAt)}
                  </span>
                </div>
                {r.summary && <div style={{ whiteSpace: "pre-wrap" }}>{r.summary}</div>}
                {r.comments.map((c) => (
                  <label key={c.id} className="row small" style={{ gap: 8, alignItems: "flex-start", opacity: c.resolved ? 0.65 : 1 }}>
                    <input type="checkbox" style={{ width: "auto", marginTop: 3 }} checked={c.resolved} onChange={(e) => resolve(c.id, e.target.checked)} />
                    <span style={{ textDecoration: c.resolved ? "line-through" : undefined }}>
                      <b>{t(c.sectionLabel)}:</b> {c.body}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {asking ? (
              <div className="stack" style={{ gap: 6 }}>
                <label htmlFor="rv-note">{t("Anything the reviewer should know? (the role you want, what you're unsure about)")}</label>
                <textarea className="prose" id="rv-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn primary small" onClick={() => call("/student/resume/review", { note })}>
                    {t("Ask for a review")}
                  </button>
                  <button className="btn ghost small" onClick={() => setAsking(false)}>
                    {t("Cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="row wrap" style={{ gap: 8 }}>
                <button className="btn small" disabled={fixes.length > 0} onClick={() => setAsking(true)}>
                  {t(r ? "Ask for another review" : "Ask a teacher to review it")}
                </button>
                {fixes.length > 0 && <span className="small muted">{t("Fix the items marked Fix first.")}</span>}
              </div>
            )}
          </>
        )}
        {msg && <ErrorBox message={msg} />}
      </div>
    </section>
  );
}
