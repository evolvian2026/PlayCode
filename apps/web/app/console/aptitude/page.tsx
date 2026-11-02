"use client";

import { useState, type FormEvent } from "react";
import { APTITUDE_TEMPLATES } from "@playcode/core";
import { useMe } from "@/components/Auth";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";
import { BAND_TONE, duration } from "@/lib/aptitude";

interface Row {
  id: string;
  name: string;
  rollNo: string | null;
  unit: string | null;
  score: number | null;
  scores: Record<string, number> | null;
  band: string | null;
  at: string | null;
  official: { score: number; at: string } | null;
}
interface Scores {
  students: Row[];
  summary: { students: number; tested: number; average: number | null; bands: Record<string, number> };
}
interface Sitting {
  id: string;
  title: string;
  units: string[];
  opensAt: string;
  closesAt: string;
  state: "upcoming" | "open" | "closed";
  invited: number;
  started: number;
  finished: number;
  average: number | null;
}
interface Results {
  sitting: { id: string; title: string };
  students: { id: string; name: string; rollNo: string | null; status: "not_started" | "in_progress" | "finished"; score: number | null; scores: Record<string, number> | null; band: string | null }[];
}

const BANDS: [string, string][] = [
  ["strong", "Strong (650+)"],
  ["good", "Good (525–645)"],
  ["developing", "Developing (400–520)"],
  ["needs_work", "Needs work (below 400)"],
];
const day = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const STATUS: Record<string, string> = { not_started: "not started", in_progress: "taking it", finished: "done", started: "started", done: "done" };
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
type Unit = { id: string; name: string; kind: string; graduated?: boolean };
type Part = { template: string; level: number; count: number };

/** Topics the students in scope get wrong most, from tests and homework in the last 90 days. */
function Struggles({ onAssign }: { onAssign: ((p: Part) => void) | null }) {
  const { data } = useApi<{ topics: { template: string; label: string; answered: number; accuracyPct: number; averageLevel: number; medianSeconds: number | null; targetSeconds: number; pace: "slow" | "on_pace" | null }[] }>("/console/aptitude/topics");
  if (!data?.topics.length) return null;
  return (
    <section className="card stack" aria-labelledby="h-struggles">
      <div>
        <h2 id="h-struggles" style={{ margin: 0, fontSize: 18 }}>
          Where the batch struggles
        </h2>
        <p className="small muted" style={{ margin: 0 }}>
          Share of answers right by topic, from adaptive tests and homework in the last 90 days, lowest first. Pace is the middle time a question in adaptive tests, against what the test allows (homework isn&apos;t timed).
        </p>
      </div>
      {data.topics.slice(0, 8).map((x) => (
        <div key={x.template} className="row wrap small" style={{ gap: 10 }}>
          <span style={{ flex: "0 0 220px" }}>{x.label}</span>
          <span aria-hidden="true" style={{ flex: "0 0 160px", height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
            <span style={{ display: "block", width: `${x.accuracyPct}%`, height: "100%", background: x.accuracyPct < 50 ? "var(--bad)" : x.accuracyPct < 70 ? "var(--warn)" : "var(--good)" }} />
          </span>
          <b style={{ width: 44 }}>{x.accuracyPct}%</b>
          <span className="muted" style={{ width: 110 }}>
            {x.answered} answers
          </span>
          <span style={{ width: 150, color: x.pace === "slow" ? "var(--warn-ink)" : undefined }} className={x.pace === "slow" ? undefined : "muted"}>
            {x.medianSeconds === null ? "" : `${duration(x.medianSeconds)} a question${x.pace === "slow" ? `, slow (${duration(x.targetSeconds)})` : ""}`}
          </span>
          {onAssign && (
            <button className="btn ghost small" onClick={() => onAssign({ template: x.template, level: Math.max(1, Math.min(5, Math.round(x.averageLevel))), count: 5 })}>
              Set homework on this
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function NewHomework({ preset, onDone }: { preset: Part | null; onDone: () => void }) {
  const units = useApi<{ units: Unit[] }>("/console/org-units");
  const [f, setF] = useState({ title: preset ? `${APTITUDE_TEMPLATES.find((x) => x.id === preset.template)?.label ?? ""} practice` : "", unitIds: [] as string[], dueAt: local(new Date(Date.now() + 3 * 86_400_000)) });
  const [parts, setParts] = useState<Part[]>(preset ? [preset] : [{ template: APTITUDE_TEMPLATES[0]!.id, level: 2, count: 5 }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const total = parts.reduce((n, p) => n + p.count, 0);
  const groups = units.data?.units.filter((u) => (u.kind === "section" || u.kind === "batch") && !u.graduated) ?? [];
  const setPart = (i: number, p: Partial<Part>) => setParts(parts.map((x, j) => (j === i ? { ...x, ...p } : x)));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ invited: number }>("/console/aptitude/homework", { body: { ...f, parts, dueAt: new Date(f.dueAt).toISOString() } });
      setMsg(`Set. ${r.invited} students were told.`);
      setF({ ...f, title: "" });
      onDone();
    } catch (err) {
      setMsg(errorMessage(err));
    }
    setBusy(false);
  }
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="h-new-hw">
      <div>
        <h2 id="h-new-hw" style={{ margin: 0, fontSize: 18 }}>
          Set aptitude homework
        </h2>
        <p className="small muted" style={{ margin: 0 }}>
          Each student gets their own numbers, so copying a classmate&apos;s answers doesn&apos;t help, and sees the working after each answer.
        </p>
      </div>
      <div>
        <label htmlFor="h-title">Title</label>
        <input id="h-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={120} placeholder="e.g. Time and work, week 1" />
      </div>
      <fieldset className="row wrap" style={{ gap: 12, border: 0, padding: 0, margin: 0 }}>
        <legend className="small muted" style={{ padding: 0, marginBottom: 6 }}>
          For
        </legend>
        {groups.map((u) => (
          <label key={u.id} className="row small" style={{ gap: 6 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={f.unitIds.includes(u.id)} onChange={(e) => setF({ ...f, unitIds: e.target.checked ? [...f.unitIds, u.id] : f.unitIds.filter((x) => x !== u.id) })} />
            {u.name}
          </label>
        ))}
      </fieldset>
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
        <legend className="small muted" style={{ padding: 0, marginBottom: 6 }}>
          Questions ({total} of up to 40)
        </legend>
        {parts.map((p, i) => (
          <div key={i} className="row wrap" style={{ gap: 8 }}>
            <select aria-label={`Topic ${i + 1}`} value={p.template} onChange={(e) => setPart(i, { template: e.target.value })} style={{ maxWidth: 260 }}>
              {APTITUDE_TEMPLATES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            <select aria-label={`Level for topic ${i + 1}`} value={p.level} onChange={(e) => setPart(i, { level: Number(e.target.value) })} style={{ width: 110 }}>
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>
                  Level {l}
                </option>
              ))}
            </select>
            <input aria-label={`Questions for topic ${i + 1}`} type="number" min={1} max={20} value={p.count} onChange={(e) => setPart(i, { count: Number(e.target.value) || 1 })} style={{ width: 80 }} />
            {parts.length > 1 && (
              <button type="button" className="btn ghost small" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setParts([...parts, { template: APTITUDE_TEMPLATES[0]!.id, level: 2, count: 5 }])}>
          Add a topic
        </button>
      </fieldset>
      <div>
        <label htmlFor="h-due">Due</label>
        <input id="h-due" type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} required style={{ maxWidth: 260 }} />
      </div>
      {msg && <div className="small">{msg}</div>}
      <div>
        <button className="btn primary small" disabled={busy}>
          Set it
        </button>
      </div>
    </form>
  );
}

interface HomeworkRow {
  id: string;
  title: string;
  units: string[];
  parts: (Part & { label: string })[];
  questions: number;
  dueAt: string;
  overdue: boolean;
  setBy: string | null;
  invited: number;
  started: number;
  finished: number;
  averagePct: number | null;
}

function HomeworkResults({ id }: { id: string }) {
  const { data, error, reload } = useApi<{ students: { id: string; name: string; rollNo: string | null; status: string; answered: number; correct: number; late: boolean }[]; topics: { template: string; label: string; answered: number; accuracyPct: number | null }[]; homework: { questions: number } }>(
    `/console/aptitude/homework/${id}`,
  );
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap small" style={{ gap: 12 }}>
        {data.topics.map((x) => (
          <span key={x.template}>
            {x.label}: <b>{x.accuracyPct === null ? "-" : `${x.accuracyPct}%`}</b> right
          </span>
        ))}
      </div>
      <div className="table-wrap">
        <table className="small">
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Status</th>
              <th scope="col">Right</th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name} {s.rollNo && <span className="muted">({s.rollNo})</span>}
                </td>
                <td>
                  {STATUS[s.status] ?? s.status}
                  {s.status === "started" ? ` (${s.answered} of ${data.homework.questions})` : ""}
                  {s.late ? " · late" : ""}
                </td>
                <td>{s.status === "not_started" ? "-" : `${s.correct} of ${s.status === "done" ? data.homework.questions : s.answered}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HomeworkTab({ manage, preset }: { manage: boolean; preset: Part | null }) {
  const { data, error, loading, reload } = useApi<{ homework: HomeworkRow[] }>("/console/aptitude/homework");
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      {manage && <NewHomework key={preset ? `${preset.template}-${preset.level}` : "new"} preset={preset} onDone={reload} />}
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.homework.length ? (
        <div className="card muted">No homework set yet.</div>
      ) : (
        data.homework.map((h) => (
          <section key={h.id} className="card stack" aria-labelledby={`h-hw-${h.id}`}>
            <div className="spread wrap" style={{ gap: 8 }}>
              <div>
                <h2 id={`h-hw-${h.id}`} style={{ margin: 0, fontSize: 17 }}>
                  {h.title}
                </h2>
                <div className="small muted">
                  {h.parts.map((p) => `${p.count} × ${p.label} (level ${p.level})`).join(" · ")}
                  <br />
                  {h.units.join(", ")} · due {when(h.dueAt)}
                  {h.setBy ? ` · set by ${h.setBy}` : ""}
                </div>
              </div>
              <div className="small">
                {h.finished} of {h.invited} done{h.averagePct !== null ? ` · ${h.averagePct}% right on average` : ""}
              </div>
            </div>
            <button className="btn ghost small" style={{ alignSelf: "flex-start" }} aria-expanded={openId === h.id} onClick={() => setOpenId(openId === h.id ? null : h.id)}>
              {openId === h.id ? "Hide students" : "Show students"}
            </button>
            {openId === h.id && <HomeworkResults id={h.id} />}
          </section>
        ))
      )}
    </>
  );
}

function StudentsTab({ onAssign }: { onAssign: ((p: Part) => void) | null }) {
  const { data, error, loading, reload } = useApi<Scores>("/console/aptitude");
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const s = data.summary;
  return (
    <>
      <Struggles onAssign={onAssign} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div className="card">
          <div className="small muted">Taken it</div>
          <b style={{ fontSize: 24 }}>
            {s.tested} of {s.students}
          </b>
        </div>
        <div className="card">
          <div className="small muted">Average score</div>
          <b style={{ fontSize: 24 }}>{s.average ?? "-"}</b>
        </div>
        {BANDS.map(([k, label]) => (
          <div key={k} className="card">
            <div className="small muted">{label}</div>
            <b style={{ fontSize: 24 }}>{s.bands[k] ?? 0}</b>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Section</th>
              <th scope="col">Latest</th>
              <th scope="col">Quantitative</th>
              <th scope="col">Reasoning</th>
              <th scope="col">Taken</th>
              <th scope="col">Official</th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name} {r.rollNo && <span className="small muted">({r.rollNo})</span>}
                </td>
                <td className="small">{r.unit ?? "-"}</td>
                <td>{r.score === null ? <span className="small muted">not taken</span> : <span className={`pill ${BAND_TONE[r.band!]}`}>{r.score}</span>}</td>
                <td>{r.scores?.quant ?? "-"}</td>
                <td>{r.scores?.reasoning ?? "-"}</td>
                <td className="small">{r.at ? day(r.at) : "-"}</td>
                <td>{r.official ? <b>{r.official.score}</b> : <span className="small muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NewSitting({ onDone }: { onDone: () => void }) {
  const units = useApi<{ units: Unit[] }>("/console/org-units");
  const [f, setF] = useState({ title: "", unitIds: [] as string[], opensAt: local(new Date()), closesAt: local(new Date(Date.now() + 3 * 3_600_000)) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ invited: number }>("/console/aptitude/sittings", { body: { ...f, opensAt: new Date(f.opensAt).toISOString(), closesAt: new Date(f.closesAt).toISOString() } });
      setMsg(`Opened. ${r.invited} students were told.`);
      setF({ ...f, title: "" });
      onDone();
    } catch (err) {
      setMsg(errorMessage(err));
    }
    setBusy(false);
  }
  // Graduated batches have no one left to take it.
  const batches = units.data?.units.filter((u) => u.kind === "batch" && !u.graduated) ?? [];
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="h-new-sitting">
      <div>
        <h2 id="h-new-sitting" style={{ margin: 0, fontSize: 18 }}>
          Open a sitting
        </h2>
        <p className="small muted" style={{ margin: 0 }}>
          Students in the chosen batches get one attempt at the adaptive test in this window, best in a lab you supervise. The score goes on their resume and is the one drives can ask a minimum of.
        </p>
      </div>
      <div>
        <label htmlFor="s-title">Title</label>
        <input id="s-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={120} placeholder="e.g. Final-year aptitude sitting, November" />
      </div>
      <fieldset className="row wrap" style={{ gap: 12, border: 0, padding: 0, margin: 0 }}>
        <legend className="small muted" style={{ padding: 0, marginBottom: 6 }}>
          Batches (none ticked: everyone)
        </legend>
        {batches.map((u) => (
          <label key={u.id} className="row small" style={{ gap: 6 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={f.unitIds.includes(u.id)} onChange={(e) => setF({ ...f, unitIds: e.target.checked ? [...f.unitIds, u.id] : f.unitIds.filter((x) => x !== u.id) })} />
            {u.name}
          </label>
        ))}
      </fieldset>
      <div className="row wrap" style={{ gap: 12 }}>
        <div>
          <label htmlFor="s-open">Opens</label>
          <input id="s-open" type="datetime-local" value={f.opensAt} onChange={(e) => setF({ ...f, opensAt: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="s-close">Closes</label>
          <input id="s-close" type="datetime-local" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} required />
        </div>
      </div>
      {msg && <div className="small">{msg}</div>}
      <div>
        <button className="btn primary small" disabled={busy}>
          Open the sitting
        </button>
      </div>
    </form>
  );
}

function SittingResults({ id, title, manage, open, onClosed }: { id: string; title: string; manage: boolean; open: boolean; onClosed: () => void }) {
  const { data, error, loading, reload } = useApi<Results>(`/console/aptitude/sittings/${id}`);
  const [msg, setMsg] = useState<string | null>(null);
  async function csv() {
    const a = document.createElement("a");
    a.href = await fetchObjectUrl(`/console/aptitude/sittings/${id}/csv`);
    a.download = `aptitude-${title.replace(/[^\w]+/g, "-").toLowerCase()}.csv`;
    a.click();
  }
  async function close() {
    if (!window.confirm("Close this sitting now? Students who haven't started can't any more; those taking it finish their sections.")) return;
    try {
      await api(`/console/aptitude/sittings/${id}/close`, { body: {} });
      onClosed();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn small" onClick={csv}>
          Download CSV
        </button>
        {manage && open && (
          <button className="btn ghost small" onClick={close}>
            Close now
          </button>
        )}
      </div>
      {msg && <ErrorBox message={msg} />}
      <div className="table-wrap">
        <table className="small">
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Status</th>
              <th scope="col">Score</th>
              <th scope="col">Quantitative</th>
              <th scope="col">Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name} {s.rollNo && <span className="muted">({s.rollNo})</span>}
                </td>
                <td>{STATUS[s.status]}</td>
                <td>{s.score !== null ? <span className={`pill ${BAND_TONE[s.band!]}`}>{s.score}</span> : "-"}</td>
                <td>{s.scores?.quant ?? "-"}</td>
                <td>{s.scores?.reasoning ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SittingsTab({ manage }: { manage: boolean }) {
  const { data, error, loading, reload } = useApi<{ sittings: Sitting[] }>("/console/aptitude/sittings");
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      {manage && <NewSitting onDone={reload} />}
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.sittings.length ? (
        <div className="card muted">No sittings yet.</div>
      ) : (
        data.sittings.map((s) => (
          <section key={s.id} className="card stack" aria-labelledby={`h-${s.id}`}>
            <div className="spread wrap" style={{ gap: 8 }}>
              <div>
                <h2 id={`h-${s.id}`} style={{ margin: 0, fontSize: 17 }}>
                  {s.title} <span className={`pill ${s.state === "open" ? "good" : s.state === "upcoming" ? "warn" : ""}`}>{s.state}</span>
                </h2>
                <div className="small muted">
                  {when(s.opensAt)} to {when(s.closesAt)} · {s.units.length ? s.units.join(", ") : "everyone"}
                </div>
              </div>
              <div className="small">
                {s.finished} of {s.invited} done{s.started > s.finished ? `, ${s.started - s.finished} taking it` : ""}
                {s.average !== null ? ` · average ${s.average}` : ""}
              </div>
            </div>
            <button className="btn ghost small" style={{ alignSelf: "flex-start" }} aria-expanded={openId === s.id} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
              {openId === s.id ? "Hide results" : "Show results"}
            </button>
            {openId === s.id && (
              <SittingResults
                id={s.id}
                title={s.title}
                manage={manage}
                open={s.state !== "closed"}
                onClosed={() => {
                  setOpenId(null);
                  reload();
                }}
              />
            )}
          </section>
        ))
      )}
    </>
  );
}

type BandKey = "needs_work" | "developing" | "good" | "strong";
const BAND_KEYS: BandKey[] = ["needs_work", "developing", "good", "strong"];
interface Comparison {
  from: { id: string; title: string; took: number };
  to: { id: string; title: string; took: number };
  summary: { students: number; from: number | null; to: number | null; change: number | null; up: number; same: number; down: number; sections: Record<string, { from: number | null; to: number | null; change: number | null }>; bands: Record<BandKey, Record<BandKey, number>> };
  byUnit: { unit: string; students: number; from: number | null; to: number | null; change: number | null; up: number; same: number; down: number }[];
  students: { id: string; name: string; rollNo: string | null; unit: string; from: number; to: number; change: number; move: "up" | "same" | "down"; fromBand: BandKey; toBand: BandKey; sections: Record<string, number> }[];
  bandLabels: Record<BandKey, string>;
}

const signed = (n: number | null) => (n === null ? "-" : n > 0 ? `+${n}` : String(n));
const MOVE_TONE = { up: "var(--good-ink)", same: undefined, down: "var(--bad-ink)" } as const;

/** Progress between two sittings, over the students who took both. */
function ProgressTab() {
  const list = useApi<{ sittings: Sitting[] }>("/console/aptitude/sittings");
  const withResults = (list.data?.sittings ?? []).filter((x) => x.finished > 0);
  const [pick, setPick] = useState<{ from: string; to: string } | null>(null);
  // Newest two with results, earlier first, until someone picks.
  const from = pick?.from ?? withResults[1]?.id ?? "";
  const to = pick?.to ?? withResults[0]?.id ?? "";
  const { data, error, loading, reload } = useApi<Comparison>(from && to ? `/console/aptitude/compare?from=${from}&to=${to}` : null);
  async function csv() {
    const a = document.createElement("a");
    a.href = await fetchObjectUrl(`/console/aptitude/compare/csv?from=${from}&to=${to}`);
    a.download = "aptitude-progress.csv";
    a.click();
  }
  if (list.loading && !list.data) return <Loading />;
  if (withResults.length < 2)
    return (
      <p className="card muted" style={{ margin: 0 }}>
        Progress needs two sittings with results. Open another sitting for the same batches, and their scores can be compared here.
      </p>
    );
  const picker = (label: string, value: string, set: (id: string) => void) => (
    <label className="small stack" style={{ gap: 4 }}>
      {label}
      <select value={value} onChange={(e) => set(e.target.value)}>
        {withResults.map((x) => (
          <option key={x.id} value={x.id}>
            {x.title}
          </option>
        ))}
      </select>
    </label>
  );
  const sum = data?.summary;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        {picker("Earlier sitting", from, (id) => setPick({ from: id, to }))}
        {picker("Later sitting", to, (id) => setPick({ from, to: id }))}
        {data && (
          <button className="btn small" onClick={csv}>
            Download CSV
          </button>
        )}
      </div>
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data || !sum ? null : sum.students === 0 ? (
        <p className="card muted" style={{ margin: 0 }}>
          No student in your scope took both. {data.from.took} took {data.from.title}; {data.to.took} took {data.to.title}.
        </p>
      ) : (
        <>
          <section className="card stack" aria-labelledby="h-progress">
            <h2 id="h-progress" style={{ margin: 0, fontSize: 18 }}>
              {sum.students} students took both
            </h2>
            <p className="small muted" style={{ margin: 0 }}>
              {data.from.took} took {data.from.title} and {data.to.took} took {data.to.title}; only those who took both are compared. A change counts when it is 30 points or more: a score is an estimate, and smaller differences may be nothing but that.
            </p>
            <div className="row wrap" style={{ gap: 24 }}>
              <div>
                <div className="small muted">Average score</div>
                <b style={{ fontSize: 22 }}>
                  {sum.from} → {sum.to}
                </b>{" "}
                <span style={{ color: (sum.change ?? 0) >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>({signed(sum.change)})</span>
              </div>
              {Object.entries(sum.sections).map(([k, v]) => (
                <div key={k}>
                  <div className="small muted">{k === "quant" ? "Quantitative" : "Reasoning"}</div>
                  <b>
                    {v.from} → {v.to}
                  </b>{" "}
                  <span className="small">({signed(v.change)})</span>
                </div>
              ))}
              <div>
                <div className="small muted">Students</div>
                <span style={{ color: "var(--good-ink)" }}>{sum.up} up</span> · {sum.same} about the same · <span style={{ color: "var(--bad-ink)" }}>{sum.down} down</span>
              </div>
            </div>
          </section>

          <div className="row wrap" style={{ gap: 12, alignItems: "flex-start" }}>
            <section className="card stack" style={{ flex: "1 1 380px" }} aria-labelledby="h-bands">
              <h2 id="h-bands" style={{ margin: 0, fontSize: 16 }}>
                Band to band
              </h2>
              <div className="table-wrap">
                <table className="small">
                  <caption className="sr-only">
                    Students by band in {data.from.title} (rows) and {data.to.title} (columns)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{data.from.title.replace(/ aptitude sitting$/i, "")} ↓ / {data.to.title.replace(/ aptitude sitting$/i, "")} →</th>
                      {BAND_KEYS.map((b) => (
                        <th key={b} scope="col">
                          {data.bandLabels[b]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {BAND_KEYS.map((f) => (
                      <tr key={f}>
                        <th scope="row">{data.bandLabels[f]}</th>
                        {BAND_KEYS.map((tb) => {
                          const n = sum.bands[f][tb];
                          const better = BAND_KEYS.indexOf(tb) > BAND_KEYS.indexOf(f);
                          const worse = BAND_KEYS.indexOf(tb) < BAND_KEYS.indexOf(f);
                          return (
                            <td key={tb} style={{ fontWeight: n ? 700 : undefined, color: !n ? "var(--muted)" : better ? "var(--good-ink)" : worse ? "var(--bad-ink)" : undefined }}>
                              {n}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="card stack" style={{ flex: "1 1 380px" }} aria-labelledby="h-by-unit">
              <h2 id="h-by-unit" style={{ margin: 0, fontSize: 16 }}>
                By class
              </h2>
              <div className="table-wrap">
                <table className="small">
                  <thead>
                    <tr>
                      <th scope="col">Class</th>
                      <th scope="col">Both</th>
                      <th scope="col">Average</th>
                      <th scope="col">Up / same / down</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byUnit.map((u) => (
                      <tr key={u.unit}>
                        <th scope="row" style={{ textTransform: "none", letterSpacing: 0, color: "var(--text)", fontSize: "0.92rem" }}>
                          {u.unit || "-"}
                        </th>
                        <td>{u.students}</td>
                        <td>
                          {u.from} → {u.to} <span style={{ color: (u.change ?? 0) >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>({signed(u.change)})</span>
                        </td>
                        <td>
                          {u.up} / {u.same} / {u.down}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="card stack" aria-labelledby="h-each">
            <h2 id="h-each" style={{ margin: 0, fontSize: 16 }}>
              Each student, biggest gain first
            </h2>
            <div className="table-wrap">
              <table className="small">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Class</th>
                    <th scope="col">Score</th>
                    <th scope="col">Change</th>
                    <th scope="col">Quantitative</th>
                    <th scope="col">Reasoning</th>
                    <th scope="col">Band</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((x) => (
                    <tr key={x.id}>
                      <td>
                        {x.name} {x.rollNo && <span className="muted">({x.rollNo})</span>}
                      </td>
                      <td>{x.unit}</td>
                      <td>
                        {x.from} → {x.to}
                      </td>
                      <td style={{ color: MOVE_TONE[x.move], fontWeight: 600 }}>{signed(x.change)}</td>
                      <td>{signed(x.sections.quant ?? null)}</td>
                      <td>{signed(x.sections.reasoning ?? null)}</td>
                      <td>
                        {x.fromBand === x.toBand ? (
                          data.bandLabels[x.toBand]
                        ) : (
                          <>
                            {data.bandLabels[x.fromBand]} → <b>{data.bandLabels[x.toBand]}</b>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function AptitudeScores() {
  const me = useMe();
  const [tab, setTab] = useState<"students" | "sittings" | "progress" | "homework">("students");
  const [preset, setPreset] = useState<Part | null>(null);
  const teach = me.permissions.includes("assignments.manage");
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
      <div>
        <h1 style={{ margin: 0 }}>Aptitude scores</h1>
        <p className="muted" style={{ margin: 0 }}>
          The adaptive aptitude test scores 100 to 900 (500 is average) for quantitative ability and logical reasoning. Students practise it as often as they like; questions are made fresh each time. The official score comes from a sitting you open: one attempt, on the resume, and the one a drive&apos;s minimum is checked against.
        </p>
      </div>
      <div className="row" role="group" aria-label="Show">
        {(
          [
            ["students", "Students"],
            ["sittings", "Sittings"],
            ["progress", "Progress"],
            ["homework", "Homework"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`btn small ${tab === k ? "primary" : ""}`} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "students" ? (
        <StudentsTab
          onAssign={
            teach
              ? (p) => {
                  setPreset(p);
                  setTab("homework");
                }
              : null
          }
        />
      ) : tab === "sittings" ? (
        <SittingsTab manage={me.permissions.includes("placements.manage")} />
      ) : tab === "progress" ? (
        <ProgressTab />
      ) : (
        <HomeworkTab manage={teach} preset={preset} />
      )}
    </div>
  );
}
