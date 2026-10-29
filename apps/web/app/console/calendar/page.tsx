"use client";

import Link from "next/link";
import { useState } from "react";
import { STAFF_CALENDAR_KINDS, type StaffCalendarEvent } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

const TONE: Record<StaffCalendarEvent["kind"], string> = { drive: "good", drive_deadline: "bad", interview_day: "accent", training: "accent", circular_due: "warn", document_due: "warn", offers_due: "bad" };
const DAY = 86_400_000;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOf = (e: StaffCalendarEvent) => (e.allDay ? e.start : ymd(new Date(e.start)));
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Four weeks at a time, from the Monday of the chosen week. */
function weekStart(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

export default function StaffCalendar() {
  const [start, setStart] = useState(() => weekStart(new Date()));
  const end = new Date(start.getTime() + 28 * DAY - 1);
  const { data, error, loading, reload } = useApi<{ events: StaffCalendarEvent[] }>(`/console/calendar?from=${start.toISOString()}&to=${end.toISOString()}`);
  const today = ymd(new Date());
  const days = new Map<string, StaffCalendarEvent[]>();
  for (const e of data?.events ?? []) (days.get(dayOf(e)) ?? days.set(dayOf(e), []).get(dayOf(e))!).push(e);
  const range = `${start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} to ${end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Calendar</h1>
          <p className="muted" style={{ margin: 0 }}>
            Drives, interview days, training sessions and every deadline, from what&apos;s already in PlayCode.
          </p>
        </div>
        <div className="row" role="group" aria-label="Weeks shown" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
          <button className="btn small" onClick={() => setStart(new Date(start.getTime() - 28 * DAY))}>
            ← Earlier
          </button>
          <button className="btn small" onClick={() => setStart(weekStart(new Date()))}>
            This week
          </button>
          <button className="btn small" onClick={() => setStart(new Date(start.getTime() + 28 * DAY))}>
            Later →
          </button>
        </div>
      </div>
      <div className="small muted" aria-live="polite">
        {range}
      </div>
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : days.size === 0 ? (
        <div className="card muted">Nothing in these four weeks.</div>
      ) : (
        [...days].map(([day, list]) => (
          <section key={day} className="card stack" style={{ gap: 8, borderColor: day === today ? "var(--accent)" : undefined }} aria-label={day}>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>
              {new Date(`${day}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
              {day === today ? <span className="pill accent" style={{ marginLeft: 8 }}>Today</span> : null}
            </h2>
            {list.map((e) => (
              <Link key={e.uid} href={new URL(e.url).pathname + new URL(e.url).search} className="spread wrap" style={{ color: "inherit", gap: 8 }}>
                <div>
                  <b>{e.title}</b>
                  <div className="small muted">
                    {e.allDay ? "All day" : `${time(e.start)}${e.end ? ` to ${time(e.end)}` : ""}`}
                    {e.location ? ` · ${e.location}` : ""}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </div>
                </div>
                <span className={`pill ${TONE[e.kind]}`}>{STAFF_CALENDAR_KINDS[e.kind]}</span>
              </Link>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
