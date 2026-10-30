"use client";

import Link from "next/link";
import { useState } from "react";
import { addDays, PEER_MODES, PEER_RATINGS, PEER_SLOTS, PEER_TRACKS, zonedTime, type PeerMode, type PeerRating, type PeerSlot, type PeerTrack, type PeerWindow } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

interface Session {
  id: string;
  track: PeerTrack;
  trackLabel: string;
  mode: "online" | "in_person";
  place: string;
  startsAt: string;
  partner: { name: string; rollNo: string | null } | null;
  askFirst: boolean;
  questions: { q: string; covers: string }[];
  given: { partnerAbsent: boolean } | null;
  received: { partnerAbsent: boolean; ratings: Record<PeerRating, number> | null; comment: string } | "hidden" | null;
}
interface Peer {
  request: { track: PeerTrack; mode: PeerMode; windows: PeerWindow[] } | null;
  upcoming: Session[];
  past: Session[];
  averages: Record<PeerRating, number | null>;
  pausedUntil: string | null;
  timeZone: string;
  today: string;
}

const SLOTS = Object.keys(PEER_SLOTS) as PeerSlot[];
const RATINGS = Object.keys(PEER_RATINGS) as PeerRating[];

function Ask({ data, onDone }: { data: Peer; onDone: (p: Peer) => void }) {
  const t = useT();
  const locale = useLocale();
  const [track, setTrack] = useState<PeerTrack>("hr");
  const [mode, setMode] = useState<PeerMode>("either");
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.today, i));
  // A slot can be picked if it starts more than an hour from now.
  const open = (date: string, slot: PeerSlot) => zonedTime(date, PEER_SLOTS[slot].start, data.timeZone).getTime() > Date.now() + 3_600_000;
  const label = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short" });
  async function send() {
    setMsg(null);
    try {
      onDone(await api<Peer>("/student/peer/request", { body: { track, mode, windows: picked.map((k) => ({ date: k.slice(0, 10), slot: k.slice(11) })) } }));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const toggle = (k: string) => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  return (
    <section className="card stack" aria-labelledby="h-ask">
      <h2 id="h-ask" style={{ margin: 0 }}>
        {t("Find a practice partner")}
      </h2>
      <div className="row wrap" style={{ gap: 16 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600 }}>
            {t("Interview")}
          </legend>
          <div className="row" style={{ gap: 10 }}>
            {(Object.keys(PEER_TRACKS) as PeerTrack[]).map((k) => (
              <label key={k} className="row small" style={{ gap: 4 }}>
                <input type="radio" name="track" style={{ width: "auto" }} checked={track === k} onChange={() => setTrack(k)} />
                {t(PEER_TRACKS[k])}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600 }}>
            {t("Where")}
          </legend>
          <div className="row" style={{ gap: 10 }}>
            {(Object.keys(PEER_MODES) as PeerMode[]).map((k) => (
              <label key={k} className="row small" style={{ gap: 4 }}>
                <input type="radio" name="mode" style={{ width: "auto" }} checked={mode === k} onChange={() => setMode(k)} />
                {t(PEER_MODES[k])}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600 }}>
          {t("When are you free? Pick as many as you can: the more you pick, the sooner you'll be paired.")}
        </legend>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <span className="sr-only">{t("Day")}</span>
                </th>
                {SLOTS.map((s) => (
                  <th key={s} className="small">
                    {t(PEER_SLOTS[s].label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d}>
                  <th scope="row" className="small" style={{ textAlign: "left" }}>
                    {label(d)}
                  </th>
                  {SLOTS.map((s) => {
                    const k = `${d}-${s}`;
                    return (
                      <td key={s}>
                        <input type="checkbox" style={{ width: "auto" }} disabled={!open(d, s)} checked={picked.includes(k)} onChange={() => toggle(k)} aria-label={`${label(d)}, ${t(PEER_SLOTS[s].label)}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <div>
        <button className="btn primary small" disabled={!picked.length} onClick={send}>
          {t("Find me a partner")}
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
    </section>
  );
}

function Upcoming({ s, timeZone, onChange }: { s: Session; timeZone: string; onChange: (p: Peer) => void }) {
  const t = useT();
  const locale = useLocale();
  const [msg, setMsg] = useState<string | null>(null);
  const when = new Date(s.startsAt).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone });
  async function cancel() {
    if (!window.confirm(t("Call off this session? Your partner will be told."))) return;
    try {
      onChange(await api<Peer>(`/student/peer/sessions/${s.id}/cancel`, { body: {} }));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <section className="card stack" aria-label={t("Upcoming session")} style={{ borderColor: "var(--accent)" }}>
      <div>
        <div className="small muted">{t("{track} mock interview", { track: t(s.trackLabel) })}</div>
        <h2 style={{ margin: 0 }}>{t("With {name}", { name: s.partner?.name ?? "" })}</h2>
        <div>{when}</div>
        <div className="small">{s.mode === "online" ? <a href={s.place} target="_blank" rel="noreferrer">{t("Join the video call")}</a> : s.place}</div>
      </div>
      <div className="small" style={{ background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8 }}>
        {s.askFirst ? t("You ask first for half an hour, then swap.") : t("Your partner asks first for half an hour, then you ask.")}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <b className="small">{t("Your questions to ask")}</b>
        {s.questions.map((q, i) => (
          <details key={q.q}>
            <summary>
              {i + 1}. {q.q}
            </summary>
            <div className="small muted" style={{ marginTop: 4 }}>
              {t("A good answer:")} {q.covers}
            </div>
          </details>
        ))}
      </div>
      <div>
        <button className="btn ghost small" onClick={cancel}>
          {t("Call it off")}
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
    </section>
  );
}

function Feedback({ s, onChange }: { s: Session; onChange: (p: Peer) => void }) {
  const t = useT();
  const [absent, setAbsent] = useState(false);
  const [ratings, setRatings] = useState<Partial<Record<PeerRating, number>>>({});
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const complete = absent || RATINGS.every((k) => ratings[k]);
  async function send() {
    setMsg(null);
    try {
      onChange(await api<Peer>(`/student/peer/sessions/${s.id}/feedback`, { body: { partnerAbsent: absent, ratings: absent ? null : ratings, comment } }));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={absent} onChange={(e) => setAbsent(e.target.checked)} />
        {t("{name} didn't come", { name: s.partner?.name ?? "" })}
      </label>
      {!absent &&
        RATINGS.map((k) => (
          <fieldset key={k} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small">{t(PEER_RATINGS[k])}</legend>
            <div className="row" style={{ gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="row small" style={{ gap: 2 }}>
                  <input type="radio" name={`${s.id}-${k}`} style={{ width: "auto" }} checked={ratings[k] === n} onChange={() => setRatings({ ...ratings, [k]: n })} />
                  {n}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      {!absent && (
        <div>
          <label htmlFor={`fb-${s.id}`} className="small">
            {t("One thing they did well, and one to work on")}
          </label>
          <textarea className="prose" id={`fb-${s.id}`} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      )}
      <div>
        <button className="btn small" disabled={!complete} onClick={send}>
          {t("Send feedback")}
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

export default function PeerPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload, setData } = useApi<Peer>("/student/peer");
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  // Times as the institution keeps them, wherever the phone is set.
  const day = (d: string) => new Date(d).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", timeZone: data.timeZone });
  async function cancelRequest() {
    setData(await api<Peer>("/student/peer/request/cancel", { body: {} }));
  }
  const avg = RATINGS.filter((k) => data.averages[k] !== null);
  return (
    <div className="stack">
      <div>
        <Link href="/play/placements" className="small muted">
          ← {t("Placements")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{t("Practice with a classmate")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Interview each other for half an hour each. You get the questions and what a good answer covers; afterwards you rate each other.")}
        </p>
      </div>
      {data.upcoming.map((s) => (
        <Upcoming key={s.id} s={s} timeZone={data.timeZone} onChange={setData} />
      ))}
      {data.pausedUntil ? (
        <div className="card small">{t("You missed two sessions recently, so you can ask for a partner again from {date}.", { date: day(data.pausedUntil) })}</div>
      ) : data.request ? (
        <div className="card stack" style={{ gap: 6 }}>
          <b>{t("Looking for a partner")}</b>
          <div className="small muted">
            {t(PEER_TRACKS[data.request.track])} · {t(PEER_MODES[data.request.mode])} · {t("{n} times picked", { n: data.request.windows.length })}. {t("You'll get a notification when someone is free at the same time.")}
          </div>
          <div>
            <button className="btn ghost small" onClick={cancelRequest}>
              {t("Stop looking")}
            </button>
          </div>
        </div>
      ) : (
        !data.upcoming.length && <Ask data={data} onDone={setData} />
      )}
      {avg.length > 0 && (
        <div className="card tight small">
          <b>{t("How partners rate you")}:</b> {avg.map((k) => `${t(PEER_RATINGS[k])} ${data.averages[k]}/5`).join(" · ")}
        </div>
      )}
      {data.past.length > 0 && <h2 style={{ margin: "8px 0 0" }}>{t("Past sessions")}</h2>}
      {data.past.map((s) => (
        <div key={s.id} className="card stack" style={{ gap: 8 }}>
          <div className="small">
            <b>{s.partner?.name}</b> · {t(s.trackLabel)} · {day(s.startsAt)}
          </div>
          {!s.given && <Feedback s={s} onChange={setData} />}
          {s.received === "hidden" ? (
            <div className="small muted">{t("{name} has rated you. Give your feedback to see it.", { name: s.partner?.name ?? "" })}</div>
          ) : s.received && !s.received.partnerAbsent ? (
            <div className="small">
              <b>{t("Their feedback")}:</b> {RATINGS.map((k) => `${t(PEER_RATINGS[k])} ${s.received && s.received !== "hidden" ? s.received.ratings?.[k] : ""}/5`).join(" · ")}
              {s.received.comment && <div>{s.received.comment}</div>}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
