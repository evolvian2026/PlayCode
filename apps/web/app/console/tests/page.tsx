"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/Auth";
import { useUnits } from "@/components/UnitPicker";
import { ErrorBox, formatDate, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface TestRow {
  id: string;
  title: string;
  proctorLevel: 1 | 2 | 3;
  durationMinutes: number;
  openAt: string;
  closeAt: string;
  state: "scheduled" | "live" | "closed";
  questionCount: number;
  started: number;
  submitted: number;
  flagged: number;
  resultsReleased: boolean;
}

interface SectionDraft {
  title: string;
  source: "skills" | "pack";
  skillIds: string[];
  packId: string;
  pick: number;
  marks: number;
  negative: number;
}

const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function NewTest({ onDone }: { onDone: () => void }) {
  const units = useUnits();
  const skills = useApi<{ skills: { id: string; name: string; topicName: string }[] }>("/console/skills");
  const packs = useApi<{ packs: { id: string; title: string; questionIds: string[] }[] }>("/console/packs");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [duration, setDuration] = useState(45);
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [release, setRelease] = useState<"manual" | "immediate">("manual");
  const [openAt, setOpenAt] = useState(local(new Date()));
  const [closeAt, setCloseAt] = useState(local(new Date(Date.now() + 3 * 3600_000)));
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [sections, setSections] = useState<SectionDraft[]>([
    { title: "Aptitude for coding", source: "skills", skillIds: [], packId: "", pick: 10, marks: 1, negative: 0.25 },
    { title: "Coding", source: "skills", skillIds: ["coding.basics"], packId: "", pick: 2, marks: 10, negative: 0 },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setSection = (i: number, patch: Partial<SectionDraft>) => setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/console/assessments", {
        body: {
          title,
          instructions,
          durationMinutes: duration,
          proctorLevel: level,
          releasePolicy: release,
          openAt: new Date(openAt).toISOString(),
          closeAt: new Date(closeAt).toISOString(),
          unitIds,
          sections: sections.map((s) => ({
            title: s.title,
            pick: s.pick,
            marks: s.marks,
            negative: s.negative,
            ...(s.source === "pack" ? { packId: s.packId } : { skillIds: s.skillIds }),
          })),
        },
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>New test</h2>
      <div className="row wrap">
        <div style={{ flex: 2, minWidth: 240 }}>
          <label htmlFor="t-title">Title</label>
          <input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mock drive: service companies" required />
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label htmlFor="t-dur">Duration (minutes)</label>
          <input id="t-dur" type="number" min={5} max={600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
      </div>
      <div>
        <label htmlFor="t-ins">Instructions for students (optional)</label>
        <textarea id="t-ins" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} style={{ fontFamily: "inherit" }} />
      </div>
      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="t-open">Opens</label>
          <input id="t-open" type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="t-close">Closes</label>
          <input id="t-close" type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="t-level">Proctoring</label>
          <select id="t-level" value={level} onChange={(e) => setLevel(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={1}>Light: tab and paste tracking</option>
            <option value={2}>Standard: + camera snapshots, one device</option>
            <option value={3}>Strict: + AI checks every snapshot for faces and phones</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="t-release">Results</label>
          <select id="t-release" value={release} onChange={(e) => setRelease(e.target.value as "manual" | "immediate")}>
            <option value="manual">I release them after review</option>
            <option value="immediate">Show right after submitting</option>
          </select>
        </div>
      </div>

      <div>
        <label>For</label>
        <div className="row wrap" style={{ gap: 6 }}>
          {units.map((u) => (
            <button type="button" key={u.id} className={`btn small ${unitIds.includes(u.id) ? "primary" : ""}`} onClick={() => setUnitIds(toggle(unitIds, u.id))}>
              {u.name}
            </button>
          ))}
        </div>
      </div>

      {sections.map((s, i) => (
        <div key={i} className="card tight stack" style={{ background: "var(--surface-2)" }}>
          <div className="row wrap">
            <div style={{ flex: 2, minWidth: 200 }}>
              <label>Section {i + 1}</label>
              <input value={s.title} onChange={(e) => setSection(i, { title: e.target.value })} />
            </div>
            <div style={{ width: 110 }}>
              <label>Questions</label>
              <input type="number" min={1} value={s.pick} onChange={(e) => setSection(i, { pick: Number(e.target.value) })} />
            </div>
            <div style={{ width: 110 }}>
              <label>Marks each</label>
              <input type="number" min={0} step={0.25} value={s.marks} onChange={(e) => setSection(i, { marks: Number(e.target.value) })} />
            </div>
            <div style={{ width: 110 }}>
              <label>Minus if wrong</label>
              <input type="number" min={0} step={0.25} value={s.negative} onChange={(e) => setSection(i, { negative: Number(e.target.value) })} />
            </div>
          </div>
          <div className="row">
            <button type="button" className={`btn small ${s.source === "skills" ? "primary" : ""}`} onClick={() => setSection(i, { source: "skills" })}>
              From skills
            </button>
            <button type="button" className={`btn small ${s.source === "pack" ? "primary" : ""}`} onClick={() => setSection(i, { source: "pack" })}>
              From a mission pack
            </button>
            {sections.length > 1 && (
              <button type="button" className="btn ghost small" style={{ marginLeft: "auto" }} onClick={() => setSections(sections.filter((_, j) => j !== i))}>
                Remove section
              </button>
            )}
          </div>
          {s.source === "skills" ? (
            <div className="row wrap" style={{ gap: 6 }}>
              {skills.data?.skills.map((sk) => (
                <button type="button" key={sk.id} className={`btn small ${s.skillIds.includes(sk.id) ? "primary" : ""}`} onClick={() => setSection(i, { skillIds: toggle(s.skillIds, sk.id) })}>
                  {sk.name}
                </button>
              ))}
            </div>
          ) : (
            <select value={s.packId} onChange={(e) => setSection(i, { packId: e.target.value })}>
              <option value="">Choose a pack</option>
              {packs.data?.packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.questionIds.length})
                </option>
              ))}
            </select>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            Each student gets their own random questions from this pool, in their own order.
          </p>
        </div>
      ))}
      <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setSections([...sections, { title: `Section ${sections.length + 1}`, source: "skills", skillIds: [], packId: "", pick: 5, marks: 1, negative: 0 }])}>
        Add section
      </button>
      {error && <ErrorBox message={error} />}
      <div className="row">
        <button className="btn primary" disabled={busy || !title || !unitIds.length}>
          {busy ? "Creating..." : "Create test"}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const STATE = { scheduled: ["Scheduled", ""], live: ["Live", "good"], closed: ["Closed", ""] } as const;

export default function Tests() {
  const me = useMe();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApi<{ assessments: TestRow[] }>("/console/assessments");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Tests</h1>
        {me.permissions.includes("assessments.manage") && !creating && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            New test
          </button>
        )}
      </div>
      {creating && (
        <NewTest
          onDone={() => {
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
                <th>Test</th>
                <th>Window</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Flagged</th>
              </tr>
            </thead>
            <tbody>
              {data?.assessments.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => router.push(`/console/tests/${a.id}`)}>
                  <td>
                    <b>{a.title}</b>
                    <div className="muted small">
                      {a.questionCount} questions · {a.durationMinutes} min · {["", "light", "camera", "camera + AI"][a.proctorLevel]} proctoring
                    </div>
                  </td>
                  <td className="small muted">
                    {formatDate(a.openAt)} to {formatDate(a.closeAt)}
                  </td>
                  <td>
                    <span className={`pill ${STATE[a.state][1]}`}>{STATE[a.state][0]}</span>
                  </td>
                  <td>
                    {a.submitted} <span className="muted small">({a.started} started)</span>
                  </td>
                  <td>{a.flagged ? <span className="pill bad">{a.flagged}</span> : "-"}</td>
                </tr>
              ))}
              {data?.assessments.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted center">
                    No tests yet.
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
