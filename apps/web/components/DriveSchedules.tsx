"use client";

import { useState, type FormEvent } from "react";
import { INTERVIEW_FEEDBACK_DIMENSIONS, type InterviewFeedbackDimension } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Panel {
  name: string;
  room: string;
  interviewer: string;
}
interface Schedule {
  id: string;
  round: number;
  roundName: string;
  startsAt: string;
  endsAt: string;
  slotMinutes: number;
  panels: Panel[];
  slots: { userId: string; name: string; rollNo: string | null; panel: number; startsAt: string; status: "scheduled" | "done" | "no_show" | "excused"; feedback: Feedback | null }[];
}

interface Feedback {
  ratings: Record<InterviewFeedbackDimension, number>;
  wentWell: string;
  workOn: string;
  by: string;
  at: string;
}

const DIMS = Object.keys(INTERVIEW_FEEDBACK_DIMENSIONS) as InterviewFeedbackDimension[];

function FeedbackForm({ driveId, schedule, slot, onSaved, onCancel }: { driveId: string; schedule: Schedule; slot: Schedule["slots"][number]; onSaved: (s: { schedules: Schedule[] }) => void; onCancel: () => void }) {
  const [ratings, setRatings] = useState<Partial<Record<InterviewFeedbackDimension, number>>>(slot.feedback?.ratings ?? {});
  const [wentWell, setWentWell] = useState(slot.feedback?.wentWell ?? "");
  const [workOn, setWorkOn] = useState(slot.feedback?.workOn ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      onSaved(await api<{ schedules: Schedule[] }>(`/console/placements/${driveId}/schedules/${schedule.id}/slots/${slot.userId}/feedback`, { method: "PUT", body: { ratings, wentWell, workOn } }));
    } catch (err) {
      setMsg(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <form className="card stack no-print" onSubmit={submit} style={{ gap: 8 }}>
      <b>
        Feedback for {slot.name}: {schedule.roundName}
      </b>
      <div className="small muted">The student sees this, without your name. Ratings from 1 (needs a lot of work) to 5 (excellent).</div>
      {DIMS.map((d) => (
        <div key={d} role="group" aria-label={INTERVIEW_FEEDBACK_DIMENSIONS[d]} className="row wrap" style={{ gap: 6 }}>
          <span className="small" style={{ minWidth: 150 }}>
            {INTERVIEW_FEEDBACK_DIMENSIONS[d]}
          </span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={`btn small ${ratings[d] === n ? "primary" : ""}`} aria-pressed={ratings[d] === n} aria-label={`${n} of 5`} onClick={() => setRatings({ ...ratings, [d]: n })} style={{ minWidth: 36 }}>
              {n}
            </button>
          ))}
        </div>
      ))}
      <div>
        <label htmlFor="f-well">What went well</label>
        <textarea id="f-well" className="prose" rows={2} value={wentWell} onChange={(e) => setWentWell(e.target.value)} maxLength={1000} />
      </div>
      <div>
        <label htmlFor="f-work">What to work on</label>
        <textarea id="f-work" className="prose" rows={2} value={workOn} onChange={(e) => setWorkOn(e.target.value)} maxLength={1000} />
      </div>
      {msg && <ErrorBox message={msg} />}
      <div className="row">
        <button className="btn primary small" disabled={busy || DIMS.some((d) => !ratings[d])}>
          {busy ? "Saving..." : "Save and tell the student"}
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const time = (d: string) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const day = (d: string) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NewSchedule({ driveId, rounds, waiting, onDone, onCancel }: { driveId: string; rounds: string[]; waiting: number[]; onDone: (s: { schedules: Schedule[] }) => void; onCancel: () => void }) {
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(10, 0, 0, 0);
  const firstWaiting = Math.max(0, waiting.findIndex((n) => n > 0));
  const [round, setRound] = useState(firstWaiting);
  const [startsAt, setStartsAt] = useState(toLocalInput(tomorrow));
  const [slotMinutes, setSlotMinutes] = useState(20);
  const [panels, setPanels] = useState<Panel[]>([
    { name: "Panel 1", room: "", interviewer: "" },
    { name: "Panel 2", room: "", interviewer: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (i: number, p: Partial<Panel>) => setPanels(panels.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      onDone(await api<{ schedules: Schedule[] }>(`/console/placements/${driveId}/schedules`, { body: { round, startsAt: new Date(startsAt).toISOString(), slotMinutes, panels } }));
    } catch (err) {
      setMsg(errorMessage(err));
      setBusy(false);
    }
  }

  const n = waiting[round] ?? 0;
  const perPanel = Math.ceil(n / Math.max(1, panels.length));
  return (
    <form className="stack" onSubmit={submit} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div className="row wrap">
        <div>
          <label htmlFor="s-round">Round</label>
          <select id="s-round" value={round} onChange={(e) => setRound(Number(e.target.value))}>
            {rounds.map((r, i) => (
              <option key={r} value={i}>
                {r} ({waiting[i] ?? 0} waiting)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="s-start">First interview at</label>
          <input id="s-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="s-len">Minutes each</label>
          <input id="s-len" type="number" min={5} max={180} value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))} style={{ maxWidth: 100 }} />
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="small" style={{ fontWeight: 600 }}>
          Panels
        </div>
        {panels.map((p, i) => (
          <div key={i} className="row wrap" style={{ gap: 6 }}>
            <input aria-label={`Panel ${i + 1} name`} value={p.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={60} required style={{ maxWidth: 160 }} />
            <input aria-label={`Panel ${i + 1} room`} placeholder="Room" value={p.room} onChange={(e) => set(i, { room: e.target.value })} maxLength={60} style={{ maxWidth: 160 }} />
            <input aria-label={`Panel ${i + 1} interviewer`} placeholder="Interviewer (optional)" value={p.interviewer} onChange={(e) => set(i, { interviewer: e.target.value })} maxLength={120} style={{ maxWidth: 240 }} />
            {panels.length > 1 && (
              <button type="button" className="btn ghost small" onClick={() => setPanels(panels.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        {panels.length < 20 && (
          <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setPanels([...panels, { name: `Panel ${panels.length + 1}`, room: "", interviewer: "" }])}>
            Add a panel
          </button>
        )}
      </div>
      <div className="small muted">
        {n
          ? `${n} students in roll-number order, about ${perPanel} per panel: the last interviews start around ${time(new Date(new Date(startsAt).getTime() + (perPanel - 1) * slotMinutes * 60_000).toISOString())}. Each student is told their time and room. Making it again for the same round replaces it.`
          : "Nobody is waiting for this round yet. Mark who cleared the round before first."}
      </div>
      {msg && <ErrorBox message={msg} />}
      <div className="row">
        <button className="btn primary small" disabled={busy || !n}>
          {busy ? "Scheduling..." : "Schedule and tell students"}
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Interview slots per round on a drive day, by panel; printable for the rooms. */
export function DriveSchedules({ driveId, rounds, waiting }: { driveId: string; rounds: string[]; waiting: number[] }) {
  const { data, error, loading, reload, setData } = useApi<{ schedules: Schedule[] }>(`/console/placements/${driveId}/schedules`);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<{ scheduleId: string; userId: string } | null>(null);

  async function mark(s: Schedule, userId: string, status: Schedule["slots"][number]["status"]) {
    setMsg(null);
    try {
      await api(`/console/placements/${driveId}/schedules/${s.id}/slots/${userId}`, { body: { status } });
      await reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <div className="card stack">
      <div className="spread wrap no-print">
        <div>
          <h2 style={{ margin: 0 }}>Interview schedule</h2>
          <div className="small muted">Panels, rooms and a time for each student, round by round.</div>
        </div>
        <div className="row">
          {data?.schedules.length ? (
            <button className="btn small" onClick={() => window.print()}>
              Print for the rooms
            </button>
          ) : null}
          {!adding && (
            <button className="btn primary small" onClick={() => setAdding(true)}>
              Schedule a round
            </button>
          )}
        </div>
      </div>
      {adding && (
        <NewSchedule
          driveId={driveId}
          rounds={rounds}
          waiting={waiting}
          onCancel={() => setAdding(false)}
          onDone={(s) => {
            setData(s);
            setAdding(false);
          }}
        />
      )}
      {msg && <ErrorBox message={msg} />}
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.schedules.length ? (
        !adding && <div className="small muted">No interviews scheduled yet.</div>
      ) : (
        data.schedules.map((s) => (
          <section key={s.id} className="stack" style={{ gap: 8 }} aria-label={s.roundName}>
            <div>
              <b>{s.roundName}</b>
              <span className="small muted">
                {" "}
                · {day(s.startsAt)}, {time(s.startsAt)} to {time(s.endsAt)} · {s.slotMinutes} min each
              </span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))" }}>
              {s.panels.map((p, i) => (
                <div key={i} className="card tight stack" style={{ gap: 4 }}>
                  <div>
                    <b>{p.name}</b>
                    <div className="small muted">{[p.room, p.interviewer].filter(Boolean).join(" · ") || "Room to be announced"}</div>
                  </div>
                  <table className="small">
                    <tbody>
                      {s.slots
                        .filter((x) => x.panel === i)
                        .map((x) => (
                          <tr key={x.userId}>
                            <td style={{ whiteSpace: "nowrap" }}>{time(x.startsAt)}</td>
                            <td>
                              {x.name}
                              <div className="muted">{x.rollNo}</div>
                            </td>
                            <td className="no-print">
                              {x.status !== "no_show" && x.status !== "excused" && (
                                <button
                                  className="btn ghost small"
                                  aria-label={`${x.feedback ? "Edit feedback" : "Feedback"} for ${x.name}`}
                                  onClick={() => setFeedbackFor({ scheduleId: s.id, userId: x.userId })}
                                >
                                  {x.feedback ? "Edit feedback" : "Feedback"}
                                </button>
                              )}
                            </td>
                            <td className="no-print">
                              <select aria-label={`${x.name}: interview status`} value={x.status} onChange={(e) => mark(s, x.userId, e.target.value as Schedule["slots"][number]["status"])} style={{ width: "auto" }}>
                                <option value="scheduled">Waiting</option>
                                <option value="done">Interviewed</option>
                                <option value="no_show">Didn&apos;t come</option>
                                <option value="excused">Excused absence</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            {feedbackFor?.scheduleId === s.id && (
              <FeedbackForm
                key={feedbackFor.userId}
                driveId={driveId}
                schedule={s}
                slot={s.slots.find((x) => x.userId === feedbackFor.userId)!}
                onCancel={() => setFeedbackFor(null)}
                onSaved={(d) => {
                  setData(d);
                  setFeedbackFor(null);
                }}
              />
            )}
          </section>
        ))
      )}
    </div>
  );
}
