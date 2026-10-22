"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMe } from "@/components/Auth";
import { EventCard, type EventItem } from "@/components/Events";
import { useUnits } from "@/components/UnitPicker";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

const AUDIENCES = [
  { id: "all", label: "Everyone" },
  { id: "inactive_7d", label: "Inactive for 7 days" },
  { id: "at_risk", label: "At risk (service readiness below 30)" },
  { id: "assignment_pending", label: "Have not finished an assignment" },
] as const;

const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Nudges() {
  const me = useMe();
  const units = useUnits();
  const history = useApi<{ history: { title: string; template: string; day: string; sentBy: string | null; total: number; whatsapp: number; read: number }[]; automaticNudges: boolean; whatsapp: boolean }>("/console/nudges");
  const assignments = useApi<{ assignments: { id: string; title: string }[] }>(me.permissions.includes("assignments.manage") ? "/console/assignments" : null);
  const [unitId, setUnitId] = useState("");
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]["id"]>("inactive_7d");
  const [assignmentId, setAssignmentId] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filter = { ...(unitId ? { unitId } : {}), audience, ...(audience === "assignment_pending" && assignmentId ? { assignmentId } : {}) };
  const key = JSON.stringify(filter);
  useEffect(() => {
    setCount(null);
    if (audience === "assignment_pending" && !assignmentId) return;
    // Ignore a slower response for a filter the user has already changed.
    let current = true;
    api<{ count: number }>("/console/nudges/preview", { body: filter })
      .then((r) => current && setCount(r.count))
      .catch(() => current && setCount(null));
    return () => {
      current = false;
    };
    // `key` captures the filter.
  }, [key]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ sent: number }>("/console/nudges", { body: { ...filter, title, message } });
      setStatus(`Sent to ${r.sent} students`);
      setTitle("");
      setMessage("");
      void history.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function toggleAuto(enabled: boolean) {
    try {
      await api("/console/settings/nudges", { method: "PUT", body: { enabled } });
      void history.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={send}>
        <h2 style={{ margin: 0 }}>Send a nudge</h2>
        <div className="row wrap">
          <div style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="n-unit">Students in</label>
            <select id="n-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">All my students</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {"  ".repeat(u.depth)}
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="n-aud">Who</label>
            <select id="n-aud" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}>
              {AUDIENCES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          {audience === "assignment_pending" && (
            <div style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="n-asg">Assignment</label>
              <select id="n-asg" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
                <option value="">Choose</option>
                {assignments.data?.assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div>
          <label htmlFor="n-title">Title</label>
          <input id="n-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. Mock drive on Friday" required />
        </div>
        <div>
          <label htmlFor="n-msg">Message</label>
          <textarea id="n-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} style={{ fontFamily: "inherit" }} required />
        </div>
        <div className="spread">
          <span className="muted small">
            {count === null ? "" : `${count} students will get this in their Messages`}
            {history.data?.whatsapp ? " and on WhatsApp if they added a number" : ". WhatsApp is not connected yet."}
          </span>
          <button className="btn primary" disabled={!count || !title || !message}>
            Send
          </button>
        </div>
        {status && <span className="pill good">{status}</span>}
        {error && <ErrorBox message={error} />}
      </form>

      {history.data && (
        <div className="card stack">
          <div className="spread">
            <h2 style={{ margin: 0 }}>Sent</h2>
            {me.permissions.includes("tenant.settings") && (
              <label className="row small" style={{ gap: 6, fontWeight: 500 }}>
                <input type="checkbox" checked={history.data.automaticNudges} onChange={(e) => toggleAuto(e.target.checked)} style={{ width: "auto" }} />
                Automatic reminders (streaks, due work, open tests)
              </label>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Message</th>
                  <th>By</th>
                  <th>Students</th>
                  <th>Read</th>
                  <th>WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {history.data.history.map((h, i) => (
                  <tr key={i}>
                    <td className="small muted">{h.day}</td>
                    <td>{h.template === "announcement" ? h.title : <span className="muted">{h.title.replace(/\d+-day/, "N-day")} (automatic)</span>}</td>
                    <td className="small">{h.sentBy ?? "PlayCode"}</td>
                    <td>{h.total}</td>
                    <td>{h.read}</td>
                    <td>{h.whatsapp}</td>
                  </tr>
                ))}
                {history.data.history.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted center">
                      Nothing sent yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Events() {
  const me = useMe();
  const units = useUnits();
  const { data, error, loading, reload } = useApi<{ events: (EventItem & { teams: string[] })[] }>("/console/competitions");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState(local(new Date()));
  const [endsAt, setEndsAt] = useState(local(new Date(Date.now() + 7 * 86_400_000)));
  const [formError, setFormError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await api("/console/competitions", { body: { title, description, unitIds: teamIds, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() } });
      setCreating(false);
      setTitle("");
      setTeamIds([]);
      void reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      {me.permissions.includes("events.manage") &&
        (creating ? (
          <form className="card stack" onSubmit={create}>
            <h2 style={{ margin: 0 }}>New event</h2>
            <input aria-label="Event title" placeholder="e.g. CSE Code Premier League" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <input aria-label="Description" placeholder="What wins, prizes (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div>
              <label>Teams (pick two or more)</label>
              <div className="row wrap" style={{ gap: 6 }}>
                {units.map((u) => (
                  <button type="button" key={u.id} className={`btn small ${teamIds.includes(u.id) ? "primary" : ""}`} onClick={() => setTeamIds(teamIds.includes(u.id) ? teamIds.filter((x) => x !== u.id) : [...teamIds, u.id])}>
                    {u.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="row wrap">
              <div style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="e-start">Starts</label>
                <input id="e-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="e-end">Ends</label>
                <input id="e-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Teams are ranked by XP earned per member during the event, so smaller sections can win.
            </p>
            {formError && <ErrorBox message={formError} />}
            <div className="row">
              <button className="btn primary" disabled={!title || teamIds.length < 2}>
                Create event
              </button>
              <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => setCreating(true)}>
            New event
          </button>
        ))}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? <Loading /> : data?.events.length === 0 ? <div className="card muted">No events yet.</div> : data?.events.map((ev) => <EventCard key={ev.id} ev={ev} />)}
    </div>
  );
}

export default function Engage() {
  const me = useMe();
  const canNudge = me.permissions.includes("nudges.send");
  const [tab, setTab] = useState<"nudges" | "events">(canNudge ? "nudges" : "events");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Engagement</h1>
        <div className="row">
          {canNudge && (
            <button className={`btn small ${tab === "nudges" ? "primary" : ""}`} onClick={() => setTab("nudges")}>
              Nudges
            </button>
          )}
          <button className={`btn small ${tab === "events" ? "primary" : ""}`} onClick={() => setTab("events")}>
            Events
          </button>
        </div>
      </div>
      {tab === "nudges" ? <Nudges /> : <Events />}
    </div>
  );
}
