"use client";

import { useState, type FormEvent } from "react";
import { PANEL_KINDS, type PanelKind, type PanelRecommendation } from "@playcode/core";
import { useUnits } from "@/components/UnitPicker";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Slot {
  id: string;
  interviewerName: string;
  kind: PanelKind;
  startsAt: string;
  durationMinutes: number;
  location: string;
  status: "open" | "booked" | "cancelled" | "done" | "no_show";
  student: { name: string; rollNo: string | null } | null;
  feedback: { overall: number; recommendation: PanelRecommendation } | null;
}

interface Data {
  slots: Slot[];
  rubric: [string, string][];
  recommendations: Record<PanelRecommendation, string>;
}

const STATUS: Record<Slot["status"], [string, string]> = {
  open: ["Open", ""],
  booked: ["Booked", "accent"],
  cancelled: ["Cancelled", ""],
  done: ["Feedback given", "good"],
  no_show: ["Missed", "bad"],
};

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NewSlots({ onDone }: { onDone: () => void }) {
  const units = useUnits();
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(10, 0, 0, 0);
  const [f, setF] = useState({ interviewerName: "", kind: "technical" as PanelKind, startsAt: toLocalInput(tomorrow), durationMinutes: 20, count: 6, location: "" });
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/console/interview-slots", { body: { ...f, startsAt: new Date(f.startsAt).toISOString(), unitIds } });
      setF({ ...f, interviewerName: "" });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>Publish slots</h2>
      <div className="row wrap">
        <div style={{ flex: 2, minWidth: 220 }}>
          <label htmlFor="slot-who">Interviewer</label>
          <input id="slot-who" value={f.interviewerName} onChange={(e) => setF({ ...f, interviewerName: e.target.value })} placeholder="e.g. Kavya Rao (alumna, Infosys)" required maxLength={80} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="slot-kind">Kind</label>
          <select id="slot-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PanelKind })}>
            {Object.entries(PANEL_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row wrap">
        <div style={{ flex: 2, minWidth: 220 }}>
          <label htmlFor="slot-start">First slot starts</label>
          <input id="slot-start" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required />
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label htmlFor="slot-mins">Minutes each</label>
          <input id="slot-mins" type="number" min={10} max={90} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} />
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label htmlFor="slot-count">Slots in a row</label>
          <input id="slot-count" type="number" min={1} max={12} value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })} />
        </div>
      </div>
      <div>
        <label htmlFor="slot-where">Where (room or meeting link)</label>
        <input id="slot-where" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} maxLength={300} />
      </div>
      <div>
        <label>Who can book</label>
        <div className="row wrap" style={{ gap: 6 }}>
          {units.map((u) => (
            <button
              type="button"
              key={u.id}
              className={`btn small ${unitIds.includes(u.id) ? "primary" : ""}`}
              aria-pressed={unitIds.includes(u.id)}
              onClick={() => setUnitIds(unitIds.includes(u.id) ? unitIds.filter((x) => x !== u.id) : [...unitIds, u.id])}
            >
              {u.name}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>
          A department or batch includes its sections. Choose none to open the slots to every student (institution-wide staff only).
        </p>
      </div>
      {error && <ErrorBox message={error} />}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy || f.interviewerName.trim().length < 2}>
        {busy ? "Publishing..." : `Publish ${f.count} slot${f.count === 1 ? "" : "s"}`}
      </button>
    </form>
  );
}

function FeedbackForm({ slot, data, onDone }: { slot: Slot; data: Data; onDone: () => void }) {
  const [scores, setScores] = useState<Record<string, number>>(Object.fromEntries(data.rubric.map(([k]) => [k, 3])));
  const [overall, setOverall] = useState(3);
  const [recommendation, setRecommendation] = useState<PanelRecommendation>("almost");
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(`/console/interview-slots/${slot.id}/feedback`, { body });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  const score = (id: string, label: string, value: number, set: (n: number) => void) => (
    <div key={id} style={{ minWidth: 150 }}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => set(Number(e.target.value))}>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div className="row wrap">
        {data.rubric.map(([k, label]) => score(`fb-${slot.id}-${k}`, label, scores[k] ?? 3, (n) => setScores({ ...scores, [k]: n })))}
        {score(`fb-${slot.id}-overall`, "Overall", overall, setOverall)}
        <div style={{ minWidth: 180 }}>
          <label htmlFor={`fb-${slot.id}-rec`}>Recommendation</label>
          <select id={`fb-${slot.id}-rec`} value={recommendation} onChange={(e) => setRecommendation(e.target.value as PanelRecommendation)}>
            {Object.entries(data.recommendations).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`fb-${slot.id}-good`}>What went well</label>
        <textarea id={`fb-${slot.id}-good`} rows={2} maxLength={2000} value={strengths} onChange={(e) => setStrengths(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`fb-${slot.id}-work`}>To work on</label>
        <textarea id={`fb-${slot.id}-work`} rows={2} maxLength={2000} value={improvements} onChange={(e) => setImprovements(e.target.value)} />
      </div>
      {error && <ErrorBox message={error} />}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => send({ scores, overall, recommendation, strengths, improvements })}>
          Send feedback
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => send({ noShow: true })}>
          They didn&apos;t come
        </button>
      </div>
    </div>
  );
}

export default function InterviewSlots() {
  const { data, error, loading, reload } = useApi<Data>("/console/interview-slots");
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = Date.now();
  async function cancel(id: string) {
    if (!window.confirm("Cancel this slot? A booked student is told.")) return;
    setActionError(null);
    try {
      await api(`/console/interview-slots/${id}/cancel`, { body: {} });
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0 }}>Interview slots</h1>
        <p className="muted" style={{ margin: 0 }}>
          Mock interviews with faculty or alumni. Publish a run of slots, students book one each, and you record the interviewer&apos;s feedback for the student afterwards.
        </p>
      </div>
      <NewSlots onDone={reload} />
      {actionError && <ErrorBox message={actionError} />}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.slots.length ? (
        <div className="card muted">No slots yet.</div>
      ) : (
        <div className="card stack" style={{ gap: 12 }}>
          {data.slots.map((s) => {
            const started = new Date(s.startsAt).getTime() <= now;
            return (
              <div key={s.id} className="stack" style={{ gap: 6 }}>
                <div className="spread wrap">
                  <div>
                    <b>{new Date(s.startsAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</b>{" "}
                    <span className="small muted">
                      · {s.durationMinutes} min · {PANEL_KINDS[s.kind]} · {s.interviewerName}
                      {s.location && ` · ${s.location}`}
                    </span>
                    <div className="small">
                      {s.student ? `${s.student.name} ${s.student.rollNo ?? ""}` : <span className="muted">Not booked</span>}
                      {s.feedback && ` · ${s.feedback.overall}/5, ${data.recommendations[s.feedback.recommendation]}`}
                    </div>
                  </div>
                  <div className="row">
                    <span className={`pill ${STATUS[s.status][1]}`}>{STATUS[s.status][0]}</span>
                    {s.status === "booked" && started && feedbackFor !== s.id && (
                      <button className="btn small primary" onClick={() => setFeedbackFor(s.id)}>
                        Record feedback
                      </button>
                    )}
                    {(s.status === "open" || (s.status === "booked" && !started)) && (
                      <button className="btn small ghost" onClick={() => cancel(s.id)}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                {feedbackFor === s.id && (
                  <FeedbackForm
                    slot={s}
                    data={data}
                    onDone={() => {
                      setFeedbackFor(null);
                      reload();
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
