"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { JAM_CATEGORIES, JAM_TOPICS, PRACTICE_TASK_KINDS, WRITING_KINDS, WRITING_TASKS, type PracticeTaskKind } from "@playcode/core";
import { useUnits } from "@/components/UnitPicker";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Task {
  id: string;
  kind: PracticeTaskKind;
  subject: string | null;
  note: string | null;
  units: { id: string; name: string }[];
  openAt: string;
  closeAt: string;
  targeted: number;
  done: number;
  average: number | null;
  outOf: 5 | 100;
}

const KINDS = Object.keys(PRACTICE_TASK_KINDS) as PracticeTaskKind[];
const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
/** A week from now at 6 pm, as a datetime-local value. */
const defaultDue = () => {
  const d = new Date(Date.now() + 7 * 86_400_000);
  d.setHours(18, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function NewTask({ onCreated }: { onCreated: () => void }) {
  const units = useUnits();
  const [kind, setKind] = useState<PracticeTaskKind>("jam");
  const [ref, setRef] = useState(JAM_TOPICS[0]!.id);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [closeAt, setCloseAt] = useState(defaultDue);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chooseKind = (k: PracticeTaskKind) => {
    setKind(k);
    setRef(k === "jam" ? JAM_TOPICS[0]!.id : k === "writing" ? WRITING_TASKS[0]!.id : "");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api<{ students: number }>("/console/practice-tasks", { body: { kind, ref: ref || null, note, unitIds, closeAt: new Date(closeAt).toISOString() } });
      setMsg(`Set for ${r.students} students. They've been notified.`);
      setNote("");
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>Set a task</h2>
      <div className="row wrap" role="group" aria-label="Kind of task" style={{ gap: 6 }}>
        {KINDS.map((k) => (
          <button key={k} type="button" className={`btn small ${kind === k ? "primary" : ""}`} aria-pressed={kind === k} onClick={() => chooseKind(k)}>
            {PRACTICE_TASK_KINDS[k]}
          </button>
        ))}
      </div>
      {kind === "jam" && (
        <div>
          <label htmlFor="pt-topic">Topic</label>
          <select id="pt-topic" value={ref} onChange={(e) => setRef(e.target.value)}>
            {Object.entries(JAM_CATEGORIES).map(([c, name]) => (
              <optgroup key={c} label={name}>
                {JAM_TOPICS.filter((x) => x.category === c).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.topic}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      {kind === "writing" && (
        <div>
          <label htmlFor="pt-task">Task</label>
          <select id="pt-task" value={ref} onChange={(e) => setRef(e.target.value)}>
            {WRITING_TASKS.map((x) => (
              <option key={x.id} value={x.id}>
                {WRITING_KINDS[x.kind]}: {x.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {(kind === "read" || kind === "repeat") && <p className="small muted" style={{ margin: 0 }}>One sitting of eight sentences counts. Drills are scored without AI.</p>}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
          For
        </legend>
        <div className="row wrap" style={{ gap: 4 }}>
          {units.map((u) => (
            <label key={u.id} className="row small" style={{ gap: 4, marginRight: 10, paddingLeft: u.depth * 12 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={unitIds.includes(u.id)} onChange={(e) => setUnitIds(e.target.checked ? [...unitIds, u.id] : unitIds.filter((x) => x !== u.id))} />
              {u.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row wrap">
        <div>
          <label htmlFor="pt-due">Due</label>
          <input id="pt-due" type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} style={{ width: "auto" }} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="pt-note">Note for students (optional)</label>
          <input id="pt-note" value={note} maxLength={500} placeholder="For example: give one example from your own life." onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {msg && (
        <span className="small" role="status">
          {msg}
        </span>
      )}
      <div>
        <button className="btn primary" disabled={busy || unitIds.length === 0}>
          {busy ? "Setting..." : "Set task"}
        </button>
      </div>
    </form>
  );
}

export default function PracticeTasks() {
  const { data, error, loading, reload } = useApi<{ tasks: Task[] }>("/console/practice-tasks");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1 style={{ margin: 0 }}>Speaking and writing tasks</h1>
        <p className="muted" style={{ margin: 0 }}>
          Set a JAM topic, a written English task, or a read-aloud or repeat drill for batches, with a due date. Students are notified and see it on their home screen; their own attempt before the due date counts, so there is
          nothing extra to hand in.
        </p>
      </div>
      <NewTask onCreated={reload} />
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.tasks.length ? (
        <div className="card muted">No tasks yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>For</th>
                  <th>Due</th>
                  <th>Done</th>
                  <th>Average</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <Link href={`/console/practice-tasks/${x.id}`}>
                        {PRACTICE_TASK_KINDS[x.kind]}
                        {x.subject && `: ${x.subject}`}
                      </Link>
                      {x.note && <div className="small muted">{x.note}</div>}
                    </td>
                    <td className="small">{x.units.map((u) => u.name).join(", ")}</td>
                    <td className="small">
                      {fmt(x.closeAt)}
                      {new Date(x.closeAt) < new Date() && <span className="muted"> (closed)</span>}
                    </td>
                    <td className="small">
                      {x.done} of {x.targeted}
                    </td>
                    <td className="small">{x.average === null ? "-" : x.outOf === 5 ? `${x.average}/5` : `${x.average}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
