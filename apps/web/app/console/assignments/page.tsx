"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { useUnits } from "@/components/UnitPicker";
import { ErrorBox, formatDate, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface AssignmentRow {
  id: string;
  title: string;
  questionCount: number;
  units: { id: string; name: string }[];
  openAt: string;
  closeAt: string;
  targeted: number;
  remedial: boolean;
  started: number;
  completed: number;
  avgScore: number | null;
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface WeakStudent {
  id: string;
  name: string;
  rollNo: string | null;
  mastery: number;
  attempts: number;
}

function NewAssignment({ onCreated, onCancel, remedialSkill }: { onCreated: () => void; onCancel: () => void; remedialSkill: string | null }) {
  const units = useUnits();
  const skills = useApi<{ skills: { id: string; name: string; topicName: string }[] }>("/console/skills");
  const packs = useApi<{ packs: { id: string; title: string; questionIds: string[]; kind: string }[] }>("/console/packs");
  const [source, setSource] = useState<"skills" | "pack" | "remedial">(remedialSkill ? "remedial" : "skills");
  const [title, setTitle] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>(remedialSkill ? [remedialSkill] : []);
  const [below, setBelow] = useState(40);
  const [includeUnpractised, setIncludeUnpractised] = useState(false);
  const [weak, setWeak] = useState<WeakStudent[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [packId, setPackId] = useState("");
  const [count, setCount] = useState(10);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [openAt, setOpenAt] = useState(toLocalInput(new Date()));
  const [closeAt, setCloseAt] = useState(toLocalInput(new Date(Date.now() + 7 * 86_400_000)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const window = { unitIds, openAt: new Date(openAt).toISOString(), closeAt: new Date(closeAt).toISOString() };
      if (source === "remedial") await api("/console/assignments/remedial", { body: { title, skillIds, count, below, includeUnpractised, studentIds: chosen, ...window } });
      else await api("/console/assignments", { body: { title, ...(source === "pack" ? { packId } : { skillIds, count }), ...window } });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function findStudents() {
    setError(null);
    try {
      const found = (await api<{ students: WeakStudent[] }>("/console/assignments/remedial/preview", { body: { skillIds, unitIds, below, includeUnpractised } })).students;
      setWeak(found);
      setChosen(found.map((s) => s.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  // A changed filter means the list must be found again.
  const resetWeak = () => {
    setWeak(null);
    setChosen([]);
  };

  const topics = new Map<string, { id: string; name: string }[]>();
  for (const s of skills.data?.skills ?? []) (topics.get(s.topicName) ?? topics.set(s.topicName, []).get(s.topicName)!).push(s);

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>New assignment</h2>
      <div>
        <label htmlFor="title">Title</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Loops practice, week 3" required maxLength={120} />
      </div>
      <div className="row">
        <button type="button" className={`btn small ${source === "skills" ? "primary" : ""}`} onClick={() => setSource("skills")}>
          Pick skills
        </button>
        <button type="button" className={`btn small ${source === "pack" ? "primary" : ""}`} onClick={() => setSource("pack")}>
          Use a mission pack
        </button>
        <button
          type="button"
          className={`btn small ${source === "remedial" ? "primary" : ""}`}
          onClick={() => {
            setSource("remedial");
            resetWeak();
          }}
        >
          Catch-up for struggling students
        </button>
      </div>
      {source === "remedial" && (
        <p className="muted small" style={{ margin: 0 }}>
          Finds the students in the chosen batches whose mastery of the skills is below a level you set, and assigns practice to just them. The report then shows how far each has come.
        </p>
      )}
      {source !== "pack" ? (
        <div className="stack">
          {[...topics.entries()].map(([topic, list]) => (
            <div key={topic}>
              <div className="muted small" style={{ fontWeight: 700 }}>
                {topic}
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {list.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`btn small ${skillIds.includes(s.id) ? "primary" : ""}`}
                    aria-pressed={skillIds.includes(s.id)}
                    onClick={() => {
                      setSkillIds(toggle(skillIds, s.id));
                      resetWeak();
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div style={{ maxWidth: 200 }}>
            <label htmlFor="count">Number of questions</label>
            <input id="count" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor="pack">Mission pack</label>
          <select id="pack" value={packId} onChange={(e) => setPackId(e.target.value)} required>
            <option value="">Choose a pack</option>
            {packs.data?.packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.questionIds.length} questions)
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label>Assign to</label>
        <div className="row wrap" style={{ gap: 6 }}>
          {units.map((u) => (
            <button
              type="button"
              key={u.id}
              className={`btn small ${unitIds.includes(u.id) ? "primary" : ""}`}
              aria-pressed={unitIds.includes(u.id)}
              onClick={() => {
                setUnitIds(toggle(unitIds, u.id));
                resetWeak();
              }}
            >
              {u.name} <span className="muted small">({u.kind})</span>
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>
          Assigning to a department or batch includes every section under it.
        </p>
      </div>
      {source === "remedial" && (
        <div className="stack">
          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            <div style={{ maxWidth: 220 }}>
              <label htmlFor="below">Mastery below (%)</label>
              <input
                id="below"
                type="number"
                min={10}
                max={90}
                value={below}
                onChange={(e) => {
                  setBelow(Number(e.target.value));
                  resetWeak();
                }}
              />
            </div>
            <label className="row small" style={{ gap: 6, margin: 0 }}>
              <input
                type="checkbox"
                checked={includeUnpractised}
                style={{ width: "auto" }}
                onChange={(e) => {
                  setIncludeUnpractised(e.target.checked);
                  resetWeak();
                }}
              />
              Include students who haven&apos;t tried these skills
            </label>
            <button type="button" className="btn" disabled={!skillIds.length || !unitIds.length} onClick={findStudents}>
              Find students
            </button>
          </div>
          {weak && (
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 4 }}>
              <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
                {weak.length === 0 ? "No students are below that level." : `${chosen.length} of ${weak.length} students chosen`}
              </legend>
              {weak.map((s) => (
                <label key={s.id} className="row small" style={{ gap: 8, margin: 0 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={chosen.includes(s.id)} onChange={() => setChosen(toggle(chosen, s.id))} />
                  <span>
                    {s.name} <span className="muted">{s.rollNo}</span> · {s.mastery}%{s.attempts === 0 ? " (not tried)" : ""}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="open">Opens</label>
          <input id="open" type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} required />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="close">Closes</label>
          <input id="close" type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} required />
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="row">
        <button className="btn primary" disabled={busy || !title || !unitIds.length || (source === "pack" ? !packId : !skillIds.length) || (source === "remedial" && !chosen.length)}>
          {busy ? "Creating..." : "Create assignment"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AssignmentsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const { data, error, loading, reload } = useApi<{ assignments: AssignmentRow[] }>("/console/assignments");

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Assignments</h1>
        {!creating && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            New assignment
          </button>
        )}
      </div>
      {creating && (
        <NewAssignment
          remedialSkill={params.get("remedial")}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Assignment</th>
                <th>For</th>
                <th>Window</th>
                <th>Completed</th>
                <th>Avg score</th>
              </tr>
            </thead>
            <tbody>
              {data?.assignments.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => router.push(`/console/assignments/${a.id}`)}>
                  <td>
                    <Link href={`/console/assignments/${a.id}`} style={{ fontWeight: 600 }}>
                      {a.title}
                    </Link>
                    <div className="muted small">
                      {a.questionCount} questions{a.remedial ? " · catch-up" : ""}
                    </div>
                  </td>
                  <td className="small">{a.units.map((u) => u.name).join(", ")}</td>
                  <td className="small muted">
                    {formatDate(a.openAt)} to {formatDate(a.closeAt)}
                  </td>
                  <td>
                    {a.completed}/{a.targeted} <span className="muted small">({a.started} started)</span>
                  </td>
                  <td>{a.avgScore === null ? "-" : `${a.avgScore}%`}</td>
                </tr>
              ))}
              {data?.assignments.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted center">
                    No assignments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Assignments() {
  return (
    <Suspense fallback={<Loading />}>
      <AssignmentsInner />
    </Suspense>
  );
}
