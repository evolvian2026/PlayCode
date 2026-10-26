"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/Auth";
import { ErrorBox, formatDate, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { STATE_LABEL } from "@/lib/contests";
import type { ContestState } from "@playcode/core";

interface Row {
  id: string;
  title: string;
  byPlayCode: boolean;
  editable: boolean;
  state: ContestState;
  startsAt: string;
  endsAt: string;
  problems: number;
  participants: number;
  submissions: number;
}

const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function NewContest({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const platform = !me.tenant;
  const problems = useApi<{ problems: { id: string; type: string; difficulty: number; stem: string }[] }>("/console/contests/problems");
  const units = useApi<{ units: { id: string; name: string; kind: string }[] }>(platform ? null : "/console/org-units");
  const colleges = useApi<{ tenants: { id: string; name: string; type: string }[] }>(platform ? "/admin/tenants" : null);
  const start = new Date(Date.now() + 86_400_000);
  start.setMinutes(0, 0, 0);
  const [f, setF] = useState({ title: "", description: "", startsAt: local(start), hours: 2, freezeMinutes: 30 });
  const [picked, setPicked] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const startsAt = new Date(f.startsAt);
    try {
      await api("/console/contests", {
        body: { title: f.title, description: f.description, problemIds: picked, audienceIds: audience, startsAt, endsAt: new Date(startsAt.getTime() + f.hours * 3_600_000), freezeMinutes: f.freezeMinutes },
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const options = platform ? (colleges.data?.tenants ?? []).filter((t) => t.type === "institution").map((t) => ({ id: t.id, name: t.name })) : (units.data?.units ?? []).filter((u) => u.kind !== "department").map((u) => ({ id: u.id, name: u.name }));
  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{platform ? "New inter-college contest" : "New contest"}</h2>
      <div className="row wrap">
        <div style={{ flex: 2, minWidth: 240 }}>
          <label htmlFor="c-title">Title</label>
          <input id="c-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} maxLength={120} placeholder="CSE coding cup" />
        </div>
        <div>
          <label htmlFor="c-start">Starts</label>
          <input id="c-start" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required />
        </div>
        <div style={{ width: 110 }}>
          <label htmlFor="c-hours">Hours</label>
          <input id="c-hours" type="number" min={0.25} max={24} step={0.25} value={f.hours} onChange={(e) => setF({ ...f, hours: Number(e.target.value) })} />
        </div>
        <div style={{ width: 150 }}>
          <label htmlFor="c-freeze">Freeze (minutes)</label>
          <input id="c-freeze" type="number" min={0} max={600} value={f.freezeMinutes} onChange={(e) => setF({ ...f, freezeMinutes: Number(e.target.value) })} />
        </div>
      </div>
      <div>
        <label htmlFor="c-desc">Rules or notes (optional)</label>
        <textarea id="c-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600 }}>Problems ({picked.length} chosen, in this order)</legend>
        {problems.loading && !problems.data ? (
          <Loading />
        ) : (
          <div className="stack" style={{ gap: 4, maxHeight: 220, overflow: "auto" }}>
            {(problems.data?.problems ?? []).map((p) => (
              <label key={p.id} className="row small" style={{ gap: 8, fontWeight: 400 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={picked.includes(p.id)} onChange={() => setPicked(toggle(picked, p.id))} />
                {picked.includes(p.id) && <b>{"ABCDEFGHIJKL"[picked.indexOf(p.id)]}.</b>}
                <span>{p.stem}</span>
                <span className="muted">
                  {p.type === "sql_query" ? "SQL" : "Code"} · {["", "easy", "medium", "hard"][p.difficulty]}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600 }}>{platform ? "Colleges taking part" : "Who takes part (none ticked: every student)"}</legend>
        <div className="row wrap">
          {options.map((o) => (
            <label key={o.id} className="row small" style={{ gap: 6, fontWeight: 400 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={audience.includes(o.id)} onChange={() => setAudience(toggle(audience, o.id))} />
              {o.name}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <ErrorBox message={error} />}
      <div className="small muted">Students taking part are notified when you create it. Problems stay hidden until the start; hidden tests are never shown.</div>
      <button className="btn primary" disabled={busy || picked.length === 0} style={{ alignSelf: "flex-start" }}>
        {busy ? "Creating..." : "Create contest"}
      </button>
    </form>
  );
}

export default function ContestsPage() {
  const me = useMe();
  const { data, error, loading, reload } = useApi<{ contests: Row[] }>("/console/contests");
  const [creating, setCreating] = useState(false);
  const canCreate = me.permissions.includes("events.manage");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Coding contests</h1>
          <p className="muted" style={{ margin: 0 }}>
            Timed contests on coding and SQL problems, scored like ICPC: problems solved, then penalty minutes.
          </p>
        </div>
        {canCreate && (
          <button className="btn primary" onClick={() => setCreating(!creating)}>
            {creating ? "Close" : "New contest"}
          </button>
        )}
      </div>
      {creating && (
        <NewContest
          onDone={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data?.contests.length === 0 ? (
        <div className="card muted">No contests yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contest</th>
                  <th>When</th>
                  <th>Problems</th>
                  <th>Taking part</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.contests.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/console/contests/${c.id}`}>{c.title}</Link>
                      {c.byPlayCode && <div className="small muted">Run by PlayCode</div>}
                    </td>
                    <td className="small">{formatDate(c.startsAt)}</td>
                    <td>{c.problems}</td>
                    <td>
                      {c.participants}
                      <div className="small muted">{c.submissions} submissions</div>
                    </td>
                    <td>
                      <span className={`pill ${c.state === "live" || c.state === "frozen" ? "good" : ""}`}>{STATE_LABEL[c.state]}</span>
                    </td>
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
