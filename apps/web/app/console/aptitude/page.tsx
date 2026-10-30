"use client";

import { useState, type FormEvent } from "react";
import { useMe } from "@/components/Auth";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";
import { BAND_TONE } from "@/lib/aptitude";

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
const STATUS: Record<string, string> = { not_started: "not started", in_progress: "taking it", finished: "done" };

function StudentsTab() {
  const { data, error, loading, reload } = useApi<Scores>("/console/aptitude");
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const s = data.summary;
  return (
    <>
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
  const units = useApi<{ units: { id: string; name: string; kind: string }[] }>("/console/org-units");
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
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
  const batches = units.data?.units.filter((u) => u.kind === "batch") ?? [];
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

export default function AptitudeScores() {
  const me = useMe();
  const [tab, setTab] = useState<"students" | "sittings">("students");
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
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`btn small ${tab === k ? "primary" : ""}`} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "students" ? <StudentsTab /> : <SittingsTab manage={me.permissions.includes("placements.manage")} />}
    </div>
  );
}
