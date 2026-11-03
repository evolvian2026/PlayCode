"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { OPENING_KINDS, type OpeningKind } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Opening {
  id: string;
  kind: OpeningKind;
  kindLabel: string;
  company: string;
  roleTitle: string;
  pay: string | null;
  location: string;
  details: string;
  applyUrl: string | null;
  closesOn: string;
  state: "open" | "closing" | "closed" | "withdrawn";
  applied: number;
  notInterested: number;
}
interface Detail {
  opening: Opening;
  responses: { userId: string; name: string; rollNo: string | null; email: string | null; response: "applied" | "not_interested"; updatedAt: string }[];
  eligible: number;
  notAnswered: number;
}

const STATE: Record<Opening["state"], [string, string]> = { open: ["Open", "good"], closing: ["Closing", "warn"], closed: ["Closed", ""], withdrawn: ["Taken down", ""] };
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA");

function NewOpening({ onCreated, onCancel }: { onCreated: (id: string, notified: number) => void; onCancel: () => void }) {
  const units = useApi<{ units: { id: string; name: string; kind: string }[] }>("/console/org-units");
  const [f, setF] = useState({ kind: "off_campus" as OpeningKind, company: "", roleTitle: "", pay: "", location: "", applyUrl: "", closesOn: inDays(7), details: "", minCgpa: "", maxBacklogs: "", years: "", allowPlaced: true });
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const pay = num(f.pay);
      const res = await api<{ opening: Opening; notified: number }>("/console/openings", {
        body: {
          kind: f.kind,
          company: f.company,
          roleTitle: f.roleTitle,
          // Jobs are entered in lakhs a year, internships in rupees a month.
          payRupees: pay === null ? null : f.kind === "internship" ? Math.round(pay) : Math.round(pay * 100_000),
          location: f.location,
          details: f.details,
          applyUrl: f.applyUrl.trim() || null,
          closesOn: f.closesOn,
          criteria: {
            unitIds,
            minCgpa: num(f.minCgpa),
            maxBacklogs: num(f.maxBacklogs),
            graduationYears: f.years.trim() ? f.years.split(/[ ,]+/).filter(Boolean).map(Number) : null,
            allowPlaced: f.allowPlaced,
          },
        },
      });
      onCreated(res.opening.id, res.notified);
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  // Departments first, then batches.
  const depts = (units.data?.units ?? []).filter((u) => u.kind !== "section").sort((a, b) => Number(a.kind !== "department") - Number(b.kind !== "department") || a.name.localeCompare(b.name));
  return (
    <form className="card stack" onSubmit={submit} aria-label="Share an opening">
      <h2 style={{ margin: 0 }}>Share an opening</h2>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div>
          <label htmlFor="o-kind">Kind</label>
          <select id="o-kind" value={f.kind} onChange={(e) => set({ kind: e.target.value as OpeningKind })}>
            {(Object.entries(OPENING_KINDS) as [OpeningKind, string][]).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="o-company">Company</label>
          <input id="o-company" value={f.company} onChange={(e) => set({ company: e.target.value })} maxLength={120} required />
        </div>
        <div>
          <label htmlFor="o-role">Role</label>
          <input id="o-role" value={f.roleTitle} onChange={(e) => set({ roleTitle: e.target.value })} maxLength={120} required />
        </div>
        <div>
          <label htmlFor="o-pay">{f.kind === "internship" ? "Stipend (₹ a month)" : "CTC (lakhs a year)"}</label>
          <input id="o-pay" type="number" min={0} step="any" value={f.pay} onChange={(e) => set({ pay: e.target.value })} />
        </div>
        <div>
          <label htmlFor="o-loc">Location or venue</label>
          <input id="o-loc" value={f.location} onChange={(e) => set({ location: e.target.value })} maxLength={120} />
        </div>
        <div>
          <label htmlFor="o-close">Last day to apply</label>
          <input id="o-close" type="date" value={f.closesOn} min={inDays(0)} onChange={(e) => set({ closesOn: e.target.value })} required />
        </div>
      </div>
      <div>
        <label htmlFor="o-url">Link to apply</label>
        <input id="o-url" type="url" value={f.applyUrl} onChange={(e) => set({ applyUrl: e.target.value })} maxLength={500} placeholder="https://" />
      </div>
      <div>
        <label htmlFor="o-details">How to apply, rounds, what to bring</label>
        <textarea id="o-details" className="prose" rows={3} value={f.details} onChange={(e) => set({ details: e.target.value })} maxLength={4000} />
      </div>
      <fieldset className="stack" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, gap: 10 }}>
        <legend className="small" style={{ fontWeight: 600 }}>
          Who can apply
        </legend>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <div>
            <label htmlFor="o-cgpa">Minimum CGPA</label>
            <input id="o-cgpa" type="number" min={0} max={10} step="0.1" value={f.minCgpa} onChange={(e) => set({ minCgpa: e.target.value })} />
          </div>
          <div>
            <label htmlFor="o-backlogs">Most backlogs</label>
            <input id="o-backlogs" type="number" min={0} max={20} value={f.maxBacklogs} onChange={(e) => set({ maxBacklogs: e.target.value })} />
          </div>
          <div>
            <label htmlFor="o-years">Graduating in</label>
            <input id="o-years" value={f.years} onChange={(e) => set({ years: e.target.value })} placeholder="2027" />
          </div>
        </div>
        {depts.length > 0 && (
          <div className="row wrap" role="group" aria-label="Departments and batches (none ticked: everyone)" style={{ gap: 10 }}>
            {depts.map((u) => (
              <label key={u.id} className="row small" style={{ gap: 4 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={unitIds.includes(u.id)} onChange={(e) => setUnitIds(e.target.checked ? [...unitIds, u.id] : unitIds.filter((x) => x !== u.id))} />
                {u.name}
              </label>
            ))}
          </div>
        )}
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={f.allowPlaced} onChange={(e) => set({ allowPlaced: e.target.checked })} />
          Students who already hold an offer can apply too
        </label>
      </fieldset>
      <div className="row">
        <button className="btn primary small" disabled={busy}>
          Share and notify eligible students
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
    </form>
  );
}

function OpeningView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, reload } = useApi<Detail>(`/console/openings/${id}`);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const o = data.opening;
  async function takeDown() {
    if (!confirm("Take this opening down? Students won't see it any more.")) return;
    try {
      await api(`/console/openings/${id}/withdraw`, { body: {} });
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const applied = data.responses.filter((r) => r.response === "applied");
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← Openings
        </button>
        <h1 style={{ margin: "6px 0 0" }}>
          {o.company}: {o.roleTitle}
        </h1>
        <div className="small muted">
          <span className={`pill ${STATE[o.state][1]}`}>{STATE[o.state][0]}</span> {o.kindLabel}
          {o.pay ? ` · ${o.pay}` : ""}
          {o.location ? ` · ${o.location}` : ""} · apply by {fmtDay(o.closesOn)}
        </div>
      </div>
      <div className="card stack" style={{ gap: 6 }}>
        {o.details && <div style={{ whiteSpace: "pre-wrap" }}>{o.details}</div>}
        {o.applyUrl && (
          <a href={o.applyUrl} target="_blank" rel="noreferrer">
            {o.applyUrl}
          </a>
        )}
        {o.state !== "withdrawn" && (
          <div>
            <button className="btn ghost small" onClick={takeDown}>
              Take down
            </button>
          </div>
        )}
      </div>
      <section className="card stack" aria-labelledby="h-resp">
        <h2 id="h-resp" style={{ margin: 0 }}>
          {applied.length} applied
        </h2>
        <div className="small muted">
          {data.eligible} students are eligible; {data.notAnswered} haven&apos;t said whether they applied.
        </div>
        {data.responses.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Said</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.responses.map((r) => (
                  <tr key={r.userId}>
                    <td>
                      <a href={`/console/students/${r.userId}`}>{r.name}</a>
                      <div className="small muted">{r.rollNo}</div>
                    </td>
                    <td>{r.response === "applied" ? <span className="pill good">Applied</span> : <span className="pill">Not for them</span>}</td>
                    <td className="small">{new Date(r.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

function Openings() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const { data, error, loading, reload } = useApi<{ openings: Opening[] }>(id ? null : "/console/openings");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (id) return <OpeningView key={id} id={id} onBack={() => router.push("/console/openings")} />;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1080 }}>
      <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Openings</h1>
          <p className="muted" style={{ margin: 0 }}>
            Off-campus drives, pool campuses and internships found elsewhere. Students who fit are told; they say when they&apos;ve applied.
          </p>
        </div>
        {!adding && (
          <button className="btn primary small" onClick={() => setAdding(true)}>
            Share an opening
          </button>
        )}
      </div>
      {adding && (
        <NewOpening
          onCancel={() => setAdding(false)}
          onCreated={(_, n) => {
            setAdding(false);
            setNotice(`Shared. ${n} eligible student${n === 1 ? " was" : "s were"} notified.`);
            reload();
          }}
        />
      )}
      {notice && (
        <div className="card tight small" role="status">
          {notice}
        </div>
      )}
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.openings.length ? (
        <div className="card muted">Nothing shared yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Opening</th>
                  <th>Kind</th>
                  <th>Apply by</th>
                  <th>Applied</th>
                </tr>
              </thead>
              <tbody>
                {data.openings.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <a
                        href={`/console/openings?id=${o.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(`/console/openings?id=${o.id}`);
                        }}
                      >
                        {o.company}: {o.roleTitle}
                      </a>
                      <div className="small muted">{[o.pay, o.location].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="small">{o.kindLabel}</td>
                    <td className="small">
                      {fmtDay(o.closesOn)} <span className={`pill ${STATE[o.state][1]}`}>{STATE[o.state][0]}</span>
                    </td>
                    <td>{o.applied}</td>
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

export default function OpeningsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Openings />
    </Suspense>
  );
}
