"use client";

import { useState } from "react";
import { PANEL_KINDS, type PanelKind, type PanelRecommendation } from "@playcode/core";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

interface Slot {
  id: string;
  interviewerName: string;
  kind: PanelKind;
  startsAt: string;
  durationMinutes: number;
  location: string;
  status: "open" | "booked" | "cancelled" | "done" | "no_show";
  canCancel?: boolean;
  feedback: { scores: Record<string, number>; overall: number; recommendation: PanelRecommendation; strengths: string; improvements: string; by: string } | null;
}

interface Data {
  open: Slot[];
  mine: Slot[];
  rubric: [string, string][];
  recommendations: Record<PanelRecommendation, string>;
}

export default function PanelInterviews() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload, setData } = useApi<Data>("/student/interview-slots");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;

  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString(intlLocale(locale), opts);
  const day = (iso: string) => fmt(iso, { weekday: "long", day: "numeric", month: "short" });
  const time = (iso: string) => fmt(iso, { hour: "numeric", minute: "2-digit" });
  async function act(path: string, id: string) {
    setBusy(id);
    setActionError(null);
    try {
      setData(await api<Data>(`/student/interview-slots/${id}/${path}`, { body: {} }));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const upcoming = data.mine.filter((s) => s.status === "booked" && new Date(s.startsAt).getTime() > Date.now() - s.durationMinutes * 60_000);
  const past = data.mine.filter((s) => !upcoming.includes(s));
  const byDay = new Map<string, Slot[]>();
  for (const s of data.open) (byDay.get(day(s.startsAt)) ?? byDay.set(day(s.startsAt), []).get(day(s.startsAt))!).push(s);

  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: 0 }}>{t("Mock interviews with people")}</h1>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          {t("Book a practice interview with a teacher or an alumnus. You'll get their feedback here afterwards.")}
        </p>
      </div>
      {actionError && <ErrorBox message={actionError} />}

      {upcoming.map((s) => (
        <section key={s.id} className="card stack" aria-label={t("Your booking")} style={{ borderColor: "var(--accent)" }}>
          <b>
            {t(PANEL_KINDS[s.kind])} · {s.interviewerName}
          </b>
          <div className="small">
            {day(s.startsAt)}, {time(s.startsAt)} · {t("{n} minutes", { n: s.durationMinutes })}
            {s.location && ` · ${s.location}`}
          </div>
          {s.canCancel ? (
            <button className="btn ghost small" style={{ alignSelf: "flex-start", paddingLeft: 0 }} disabled={busy !== null} onClick={() => act("cancel", s.id)}>
              {t("Cancel booking")}
            </button>
          ) : (
            <div className="small muted">{t("It's too close to the start to cancel online. Tell the placement cell if you can't make it.")}</div>
          )}
        </section>
      ))}

      <section className="card stack" aria-labelledby="open-slots">
        <h2 id="open-slots" style={{ margin: 0 }}>
          {t("Open slots")}
        </h2>
        {data.open.length === 0 ? (
          <div className="small muted">{t("No open slots right now. Your placement cell will post more.")}</div>
        ) : (
          [...byDay.entries()].map(([d, list]) => (
            <div key={d} className="stack" style={{ gap: 6 }}>
              <b className="small">{d}</b>
              {list.map((s) => (
                <div key={s.id} className="spread wrap">
                  <div className="small">
                    <b>{time(s.startsAt)}</b> · {t(PANEL_KINDS[s.kind])} · {s.interviewerName}
                    <div className="muted">
                      {t("{n} minutes", { n: s.durationMinutes })}
                      {s.location && ` · ${s.location}`}
                    </div>
                  </div>
                  <button className="btn small primary" disabled={busy !== null || upcoming.length > 0} onClick={() => act("book", s.id)}>
                    {busy === s.id ? t("Booking...") : t("Book")}
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
        {upcoming.length > 0 && data.open.length > 0 && <div className="small muted">{t("You can book another once this one is done or cancelled.")}</div>}
      </section>

      {past.length > 0 && (
        <section className="stack" aria-labelledby="past-panels">
          <h2 id="past-panels" style={{ margin: 0 }}>
            {t("Past interviews")}
          </h2>
          {past.map((s) => (
            <article key={s.id} className="card stack" style={{ gap: 8 }}>
              <div className="spread wrap">
                <b>
                  {t(PANEL_KINDS[s.kind])} · {s.interviewerName}
                </b>
                <span className="small muted">{day(s.startsAt)}</span>
              </div>
              {s.feedback ? (
                <>
                  <div className="row wrap">
                    <span className={`pill ${s.feedback.recommendation === "ready" ? "good" : s.feedback.recommendation === "almost" ? "warn" : "bad"}`}>{t(data.recommendations[s.feedback.recommendation])}</span>
                    <span className="small">{t("Overall {n}/5", { n: s.feedback.overall })}</span>
                  </div>
                  {data.rubric.map(([key, label]) => (
                    <div key={key}>
                      <div className="spread small">
                        <span>{t(label)}</span>
                        <b>{s.feedback!.scores[key]}/5</b>
                      </div>
                      <Bar value={(s.feedback!.scores[key] ?? 0) * 20} tone={(s.feedback!.scores[key] ?? 0) >= 4 ? "good" : (s.feedback!.scores[key] ?? 0) === 3 ? "warn" : "bad"} label={t(label)} />
                    </div>
                  ))}
                  {s.feedback.strengths && (
                    <div className="small">
                      <b>{t("What went well")}:</b> {s.feedback.strengths}
                    </div>
                  )}
                  {s.feedback.improvements && (
                    <div className="small">
                      <b>{t("To work on")}:</b> {s.feedback.improvements}
                    </div>
                  )}
                  <div className="small muted">{t("Feedback recorded by {name}", { name: s.feedback.by })}</div>
                </>
              ) : (
                <div className="small muted">{t(s.status === "cancelled" ? "Cancelled by the placement cell." : s.status === "no_show" ? "Marked as missed." : "Feedback not in yet.")}</div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
