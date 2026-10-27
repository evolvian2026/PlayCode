"use client";

import Link from "next/link";
import { useState } from "react";
import { CALENDAR_KINDS, type CalendarEvent } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

interface Data {
  events: CalendarEvent[];
  feed: { active: boolean; createdAt: string | null };
}

const TONE: Record<CalendarEvent["kind"], string> = { training: "accent", test: "warn", assignment: "", contest: "good", drive: "good", drive_deadline: "bad", interview: "accent" };

function FeedCard({ feed, onChange }: { feed: Data["feed"]; onChange: () => void }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      setUrl((await api<{ url: string }>("/student/calendar/feed", { body: {} })).url);
      onChange();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!window.confirm(t("Stop the link? Calendars subscribed to it stop updating."))) return;
    setBusy(true);
    try {
      await api("/student/calendar/feed", { method: "DELETE" });
      setUrl(null);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      setMsg(t("Link copied"));
    } catch {
      setMsg(t("Select the link and copy it."));
    }
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("Add to your phone's calendar")}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {t("Get a private link and subscribe to it in Google Calendar, or on iPhone under Settings, Calendar, Accounts, Add subscribed calendar. It updates by itself. Anyone with the link can see your schedule, so don't share it.")}
      </p>
      {url ? (
        <>
          <input readOnly value={url} aria-label={t("Your calendar link")} onFocus={(e) => e.target.select()} style={{ fontFamily: "var(--mono)", fontSize: "0.8rem" }} />
          <div className="row wrap">
            <button className="btn primary small" onClick={copy}>
              {t("Copy link")}
            </button>
            <a className="btn small" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https?:/, "webcal:"))}`} target="_blank" rel="noreferrer">
              {t("Open in Google Calendar")}
            </a>
          </div>
          <div className="small muted">{t("This is the only time the link is shown. If you lose it, make a new one.")}</div>
        </>
      ) : (
        <div className="row wrap">
          <button className="btn primary small" disabled={busy} onClick={create}>
            {t(feed.active ? "Make a new link" : "Get my calendar link")}
          </button>
          {feed.active && (
            <button className="btn ghost small" disabled={busy} onClick={stop}>
              {t("Stop the link")}
            </button>
          )}
        </div>
      )}
      {feed.active && !url && <div className="small muted">{t("A link is active. Making a new one stops the old one.")}</div>}
      {msg && (
        <div className="small" role="status">
          {msg}
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload } = useApi<Data>("/student/calendar");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const lang = locale === "hi" ? "hi-IN" : "en-IN";
  const dayOf = (e: CalendarEvent) => (e.allDay ? e.start : new Date(e.start).toLocaleDateString("en-CA"));
  const days = new Map<string, CalendarEvent[]>();
  for (const e of data.events) days.set(dayOf(e), [...(days.get(dayOf(e)) ?? []), e]);
  const today = new Date().toLocaleDateString("en-CA");
  const time = (e: CalendarEvent) =>
    e.allDay ? t("All day") : `${new Date(e.start).toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" })}${e.end && e.kind !== "test" ? `–${new Date(e.end).toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" })}` : ""}`;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Calendar")}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {t("Training sessions, tests, deadlines, contests, drives and mock interviews, from last week to two months ahead.")}
      </p>
      {days.size === 0 ? (
        <div className="card muted">{t("Nothing on your calendar yet.")}</div>
      ) : (
        [...days].map(([day, events]) => (
          <section key={day} className="stack" style={{ gap: 6 }} aria-label={day}>
            <h2 style={{ margin: 0, fontSize: "1rem", color: day < today ? "var(--muted)" : undefined }}>
              {new Date(`${day}T12:00:00`).toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" })}
              {day === today ? ` · ${t("Today")}` : ""}
            </h2>
            {events.map((e) => (
              <Link key={e.uid} href={new URL(e.url).pathname} className="card tight spread" style={{ color: "inherit", gap: 8, opacity: day < today ? 0.7 : 1 }}>
                <div>
                  <b>{e.title}</b>
                  <div className="small muted">
                    {time(e)}
                    {e.location ? ` · ${e.location}` : ""}
                  </div>
                </div>
                <span className={`pill ${TONE[e.kind]}`}>{t(CALENDAR_KINDS[e.kind])}</span>
              </Link>
            ))}
          </section>
        ))
      )}
      <FeedCard feed={data.feed} onChange={reload} />
    </div>
  );
}
