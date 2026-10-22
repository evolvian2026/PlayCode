"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface PathRow {
  id: string;
  title: string;
  status: "active" | "archived";
  units: { id: string; name: string }[];
  stepCount: number;
  startsAt: string;
  learners: number;
  completed: number;
  overdue: number;
}

type StepDraft = { kind: "skill" | "pack"; ref: string; target: string; dueDays: string };

const today = () => new Date().toISOString().slice(0, 10);

function Builder({ onCreated }: { onCreated: () => void }) {
  const units = useApi<{ units: { id: string; name: string; kind: string }[] }>("/console/org-units");
  const skills = useApi<{ skills: { id: string; name: string; topicName: string }[] }>("/console/skills");
  const packs = useApi<{ packs: { id: string; title: string; passMark: number }[] }>("/console/packs");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState(today());
  const [sequential, setSequential] = useState(true);
  const [steps, setSteps] = useState<StepDraft[]>([{ kind: "skill", ref: "", target: "60", dueDays: "7" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setStep = (i: number, patch: Partial<StepDraft>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setSteps(next);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/console/paths", {
        body: {
          title,
          description,
          unitIds,
          sequential,
          startsAt: new Date(`${startsAt}T00:00:00`).toISOString(),
          steps: steps.map((s) => ({ kind: s.kind, ref: s.ref, ...(s.target ? { target: Number(s.target) } : {}), dueDays: s.dueDays === "" ? null : Number(s.dueDays) })),
        },
      });
      setTitle("");
      setDescription("");
      setSteps([{ kind: "skill", ref: "", target: "60", dueDays: "7" }]);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>New learning path</h2>
      <div className="row wrap">
        <div style={{ flex: 2, minWidth: 240 }}>
          <label htmlFor="p-title">Title</label>
          <input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} placeholder="e.g. Service company placement track, New joiner Java onboarding" />
        </div>
        <div>
          <label htmlFor="p-start">Starts</label>
          <input id="p-start" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </div>
      </div>
      <div>
        <label htmlFor="p-desc">Description (shown to learners)</label>
        <input id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </div>
      <div>
        <label>For</label>
        <div className="row wrap">
          {units.data?.units.map((u) => (
            <label key={u.id} className="row" style={{ gap: 4, fontWeight: 500 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={unitIds.includes(u.id)} onChange={(e) => setUnitIds(e.target.checked ? [...unitIds, u.id] : unitIds.filter((x) => x !== u.id))} />
              {u.name}
            </label>
          ))}
        </div>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <label style={{ margin: 0 }}>Steps</label>
        {steps.map((s, i) => (
          <div key={i} className="row wrap" style={{ alignItems: "flex-end" }}>
            <span className="small muted" style={{ width: 18 }}>
              {i + 1}.
            </span>
            <select aria-label={`Step ${i + 1} kind`} value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as "skill" | "pack", ref: "", target: e.target.value === "skill" ? "60" : "" })} style={{ width: "auto" }}>
              <option value="skill">Master a skill</option>
              <option value="pack">Pass a mission</option>
            </select>
            <select aria-label={`Step ${i + 1}`} value={s.ref} onChange={(e) => setStep(i, { ref: e.target.value })} required style={{ flex: 1, minWidth: 200 }}>
              <option value="">Choose...</option>
              {s.kind === "skill"
                ? skills.data?.skills.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.topicName}: {k.name}
                    </option>
                  ))
                : packs.data?.packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
            </select>
            <div style={{ width: 110 }}>
              <label className="small">{s.kind === "skill" ? "Mastery %" : "Pass %"}</label>
              <input aria-label={`Step ${i + 1} target`} type="number" min={10} max={100} value={s.target} placeholder="default" onChange={(e) => setStep(i, { target: e.target.value })} />
            </div>
            <div style={{ width: 120 }}>
              <label className="small">Due after (days)</label>
              <input aria-label={`Step ${i + 1} due`} type="number" min={0} max={365} value={s.dueDays} placeholder="no deadline" onChange={(e) => setStep(i, { dueDays: e.target.value })} />
            </div>
            <button type="button" className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              Up
            </button>
            <button type="button" className="btn ghost small" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              Down
            </button>
            <button type="button" className="btn ghost small" disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setSteps([...steps, { kind: "skill", ref: "", target: "60", dueDays: "" }])}>
          Add step
        </button>
      </div>
      <label className="row" style={{ gap: 6, fontWeight: 500 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={sequential} onChange={(e) => setSequential(e.target.checked)} /> Unlock steps one at a time
      </label>
      <p className="small muted" style={{ margin: 0 }}>
        A skill step is done at the mastery level you set, after at least 5 answers. A mission step is done when the learner scores the pass mark. Learners who finish
        every step get a verifiable certificate.
      </p>
      {error && <ErrorBox message={error} />}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy || !title || unitIds.length === 0 || steps.some((s) => !s.ref)}>
        Create path
      </button>
    </form>
  );
}

export default function PathsPage() {
  const { data, error, loading, reload } = useApi<{ paths: PathRow[] }>("/console/paths");
  const [creating, setCreating] = useState(false);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Learning paths</h1>
          <p className="muted" style={{ margin: 0 }}>
            Sequences of skills and missions with deadlines: placement tracks for batches, onboarding and upskilling for teams.
          </p>
        </div>
        <button className="btn primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "Close" : "New path"}
        </button>
      </div>
      {creating && (
        <Builder
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data?.paths.length === 0 ? (
        <div className="card muted">No learning paths yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>For</th>
                  <th>Steps</th>
                  <th>Completed</th>
                  <th>Behind</th>
                </tr>
              </thead>
              <tbody>
                {data?.paths.map((p) => (
                  <tr key={p.id} style={{ opacity: p.status === "archived" ? 0.6 : 1 }}>
                    <td>
                      <Link href={`/console/paths/${p.id}`}>{p.title}</Link>
                      <div className="small muted">
                        from {new Date(p.startsAt).toLocaleDateString()}
                        {p.status === "archived" && " · archived"}
                      </div>
                    </td>
                    <td className="small">{p.units.map((u) => u.name).join(", ")}</td>
                    <td>{p.stepCount}</td>
                    <td>
                      {p.completed} / {p.learners}
                    </td>
                    <td>{p.overdue ? <span className="pill bad">{p.overdue}</span> : <span className="pill good">0</span>}</td>
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
