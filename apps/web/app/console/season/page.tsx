"use client";

import { useState } from "react";
import { formatLpa } from "@playcode/core";
import { useMe } from "@/components/Auth";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

type Progress = { placedPct: number; needed: number; met: boolean } | null;
interface Season {
  year: number;
  totals: { graduating: number; placed: number; higherStudies: number; medianCtc: number | null; highestCtc: number | null; target: number | null; progress: Progress };
  departments: { department: string; unitId: string | null; graduating: number; placed: number; higherStudies: number; medianCtc: number | null; target: number | null; progress: Progress }[];
  byMonth: { month: string; offers: number; total: number }[];
  topRecruiters: { company: string; hired: number; medianCtc: number | null }[];
  openDrives: number;
  pendingReports: number;
}
interface Targets {
  year: number;
  institution: number | null;
  departments: { id: string; name: string; targetPct: number | null }[];
}
interface Brochure {
  about: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
}

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });

/** Placed share of the batch as a bar, with the target marked on it. */
function TargetBar({ placed, graduating, target, label }: { placed: number; graduating: number; target: number | null; label: string }) {
  const share = pct(placed, graduating);
  const tone = target === null ? "" : share >= target ? "good" : share >= target - 15 ? "warn" : "bad";
  return (
    <div style={{ position: "relative" }}>
      <div className={`bar ${tone}`} style={{ height: 12 }} role="img" aria-label={`${label}: ${share}% placed${target === null ? "" : `, target ${target}%`}`}>
        <span style={{ width: `${Math.min(100, share)}%` }} />
      </div>
      {target !== null && <div aria-hidden style={{ position: "absolute", top: -3, bottom: -3, left: `${target}%`, width: 2, background: "var(--text)" }} />}
    </div>
  );
}

function Standing({ progress, target }: { progress: Progress; target: number | null }) {
  if (target === null || !progress) return <span className="muted">No target</span>;
  if (progress.met) return <span className="pill good">Target met</span>;
  return (
    <span>
      <b>{progress.needed}</b> more to reach {target}%
    </span>
  );
}

function TargetsEditor({ year, onSaved }: { year: number; onSaved: () => void }) {
  const { data, error, loading, setData } = useApi<Targets>(`/console/placements/targets?year=${year}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} />;
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      setData(await api<Targets>("/console/placements/targets", { method: "PUT", body: { year, institution: data!.institution, departments: data!.departments.map((d) => ({ unitId: d.id, targetPct: d.targetPct })) } }));
      setMsg("Targets saved.");
      onSaved();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-labelledby="h-targets">
      <h2 id="h-targets" style={{ margin: 0 }}>
        Targets for the batch of {year}
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        The share of each department&apos;s graduating students to place. Leave a box empty for no target.
      </p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div>
          <label htmlFor="t-inst">Institution (%)</label>
          <input id="t-inst" type="number" min={1} max={100} value={data.institution ?? ""} onChange={(e) => setData({ ...data, institution: num(e.target.value) })} />
        </div>
        {data.departments.map((d, i) => (
          <div key={d.id}>
            <label htmlFor={`t-${d.id}`}>{d.name} (%)</label>
            <input
              id={`t-${d.id}`}
              type="number"
              min={1}
              max={100}
              value={d.targetPct ?? ""}
              onChange={(e) => setData({ ...data, departments: data.departments.map((x, j) => (j === i ? { ...x, targetPct: num(e.target.value) } : x)) })}
            />
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary small" disabled={busy} onClick={save}>
          Save targets
        </button>
        {msg && (
          <span className="small" role="status">
            {msg}
          </span>
        )}
      </div>
    </section>
  );
}

function BrochureCard({ year }: { year: number }) {
  const { data, error, loading, setData } = useApi<{ settings: Brochure }>("/console/placements/brochure/settings");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} />;
  const s = data.settings;
  const set = (patch: Partial<Brochure>) => setData({ settings: { ...s, ...patch } });
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      setData({ settings: await api<Brochure>("/console/placements/brochure/settings", { method: "PUT", body: s }) });
      setMsg("Saved.");
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setMsg(null);
    try {
      const url = await fetchObjectUrl(`/console/placements/brochure?year=${year}`);
      const a = document.createElement("a");
      a.href = url;
      a.download = `placement-brochure-${year}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <section className="card stack" aria-labelledby="h-brochure">
      <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <div>
          <h2 id="h-brochure" style={{ margin: 0 }}>
            Placement brochure
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            A PDF to send recruiters: the batch by department, last season&apos;s results, the companies that have hired here, training, and whom to contact. The figures come from PlayCode.
          </p>
        </div>
        <button className="btn primary small" onClick={download}>
          Download brochure (PDF)
        </button>
      </div>
      <div>
        <label htmlFor="b-about">About the institution</label>
        <textarea id="b-about" className="prose" rows={4} value={s.about} onChange={(e) => set({ about: e.target.value })} maxLength={3000} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div>
          <label htmlFor="b-name">Contact name</label>
          <input id="b-name" value={s.contactName} onChange={(e) => set({ contactName: e.target.value })} maxLength={120} />
        </div>
        <div>
          <label htmlFor="b-role">Their role</label>
          <input id="b-role" value={s.contactRole} onChange={(e) => set({ contactRole: e.target.value })} maxLength={120} />
        </div>
        <div>
          <label htmlFor="b-email">Email</label>
          <input id="b-email" type="email" value={s.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} maxLength={200} />
        </div>
        <div>
          <label htmlFor="b-phone">Phone</label>
          <input id="b-phone" type="tel" value={s.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} maxLength={20} />
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn small" disabled={busy} onClick={save}>
          Save brochure details
        </button>
        {msg && (
          <span className="small" role="status">
            {msg}
          </span>
        )}
      </div>
    </section>
  );
}

export default function SeasonPage() {
  const me = useMe();
  const manage = me.permissions.includes("placements.manage");
  const [year, setYear] = useState<number | null>(null);
  const { data, error, loading, reload } = useApi<{ years: number[]; season: Season | null }>(`/console/placements/season${year ? `?year=${year}` : ""}`);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  const s = data?.season;
  const maxMonth = Math.max(1, ...(s?.byMonth.map((m) => m.offers) ?? []));

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1080 }}>
      <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Placement season</h1>
          <p className="muted" style={{ margin: 0 }}>
            How the graduating batch is doing against its targets, department by department.
          </p>
        </div>
        {data && data.years.length > 1 && (
          <div>
            <label htmlFor="s-year">Batch</label>
            <select id="s-year" value={s?.year ?? ""} onChange={(e) => setYear(Number(e.target.value))}>
              {data.years.map((y) => (
                <option key={y} value={y}>
                  Graduating {y}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {!s ? (
        <div className="card muted">No graduating batch is on record yet. Import academic records under Placements first.</div>
      ) : (
        <>
          <section className="card stack" aria-labelledby="h-batch">
            <h2 id="h-batch" style={{ margin: 0 }}>
              Batch of {s.year}
            </h2>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>
                  {pct(s.totals.placed, s.totals.graduating)}%
                </div>
                <div className="small muted">
                  placed ({s.totals.placed} of {s.totals.graduating})
                </div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{s.totals.target === null ? "-" : `${s.totals.target}%`}</div>
                <div className="small muted">target</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{s.totals.medianCtc ? formatLpa(s.totals.medianCtc) : "-"}</div>
                <div className="small muted">median package</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{s.openDrives}</div>
                <div className="small muted">drives open now</div>
              </div>
            </div>
            <TargetBar placed={s.totals.placed} graduating={s.totals.graduating} target={s.totals.target} label="Institution" />
            <div className="small">
              <Standing progress={s.totals.progress} target={s.totals.target} />
              {s.pendingReports > 0 && <span className="muted"> · {s.pendingReports} off-campus reports waiting to be verified aren&apos;t counted</span>}
            </div>
          </section>

          <section className="card stack" aria-labelledby="h-depts">
            <h2 id="h-depts" style={{ margin: 0 }}>
              By department
            </h2>
            {s.departments.map((d) => (
              <div key={d.department} className="stack" style={{ gap: 4 }}>
                <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                  <b>{d.department}</b>
                  <span className="small">
                    {d.placed} of {d.graduating} placed ({pct(d.placed, d.graduating)}%) · <Standing progress={d.progress} target={d.target} />
                  </span>
                </div>
                <TargetBar placed={d.placed} graduating={d.graduating} target={d.target} label={d.department} />
              </div>
            ))}
            <div className="small muted">The dark mark on each bar is the target.</div>
          </section>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            <section className="card stack" aria-labelledby="h-months">
              <h2 id="h-months" style={{ margin: 0 }}>
                Campus offers by month
              </h2>
              {s.byMonth.length === 0 ? (
                <div className="muted small">No offers yet.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Offers</th>
                      <th>So far</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.byMonth.map((m) => (
                      <tr key={m.month}>
                        <td className="small">{monthLabel(m.month)}</td>
                        <td style={{ width: "50%" }}>
                          <div className="row" style={{ gap: 6 }}>
                            <div className="bar" style={{ flex: 1 }} aria-hidden>
                              <span style={{ width: `${(m.offers / maxMonth) * 100}%` }} />
                            </div>
                            <span className="small">{m.offers}</span>
                          </div>
                        </td>
                        <td className="small">{m.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="card stack" aria-labelledby="h-top">
              <h2 id="h-top" style={{ margin: 0 }}>
                Top recruiters
              </h2>
              {s.topRecruiters.length === 0 ? (
                <div className="muted small">Nobody placed yet.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Hired</th>
                      <th>Median</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.topRecruiters.map((r) => (
                      <tr key={r.company}>
                        <td>{r.company}</td>
                        <td>{r.hired}</td>
                        <td className="small">{r.medianCtc ? formatLpa(r.medianCtc) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="small muted">Each graduate counts once, at the offer they took.</div>
            </section>
          </div>

          {manage && <TargetsEditor key={s.year} year={s.year} onSaved={reload} />}
          {manage && <BrochureCard year={s.year} />}
        </>
      )}
    </div>
  );
}
