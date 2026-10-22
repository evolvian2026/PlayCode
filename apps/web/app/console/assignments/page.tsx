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
  started: number;
  completed: number;
  avgScore: number | null;
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NewAssignment({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const units = useUnits();
  const skills = useApi<{ skills: { id: string; name: string; topicName: string }[] }>("/console/skills");
  const packs = useApi<{ packs: { id: string; title: string; questionIds: string[]; kind: string }[] }>("/console/packs");
  const [source, setSource] = useState<"skills" | "pack">("skills");
  const [title, setTitle] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
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
      await api("/console/assignments", {
        body: {
          title,
          ...(source === "pack" ? { packId } : { skillIds, count }),
          unitIds,
          openAt: new Date(openAt).toISOString(),
          closeAt: new Date(closeAt).toISOString(),
        },
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

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
      </div>
      {source === "skills" ? (
        <div className="stack">
          {[...topics.entries()].map(([topic, list]) => (
            <div key={topic}>
              <div className="muted small" style={{ fontWeight: 700 }}>
                {topic}
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {list.map((s) => (
                  <button type="button" key={s.id} className={`btn small ${skillIds.includes(s.id) ? "primary" : ""}`} onClick={() => setSkillIds(toggle(skillIds, s.id))}>
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
            <button type="button" key={u.id} className={`btn small ${unitIds.includes(u.id) ? "primary" : ""}`} onClick={() => setUnitIds(toggle(unitIds, u.id))}>
              {u.name} <span className="muted small">({u.kind})</span>
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>
          Assigning to a department or batch includes every section under it.
        </p>
      </div>
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
        <button className="btn primary" disabled={busy || !title || !unitIds.length || (source === "skills" ? !skillIds.length : !packId)}>
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
                    <div className="muted small">{a.questionCount} questions</div>
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
