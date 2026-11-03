"use client";

import Link from "next/link";
import { useState } from "react";
import { formatLpa } from "@playcode/core";
import { Bar, ErrorBox, Loading, Stat } from "@/components/ui";
import { fetchObjectUrl, useApi } from "@/lib/api";

interface Outcomes {
  students: number;
  registered: number;
  placed: number;
  placedPct: number;
  offers: number;
  ctc: { highest: number | null; median: number | null; average: number | null };
  byEngagement: { id: string; label: string; detail: string; students: number; placed: number; placedPct: number }[];
  byReadiness: { band: "ready" | "almost" | "building" | "at_risk"; applications: number; offers: number; offerPct: number }[];
  headline: { regularPct: number; othersPct: number } | null;
  departments: { id: string; name: string; students: number; registered: number; placed: number; placedPct: number }[];
  companies: { id: string; company: string; roleTitle: string; driveDate: string; ctcRupees: number; registered: number; offers: number }[];
}

const BAND_LABELS = { ready: "Ready (70+)", almost: "Almost (50-69)", building: "Building (30-49)", at_risk: "At risk (under 30)" };

export default function PlacementOutcomes() {
  const units = useApi<{ units: { id: string; name: string; kind: string }[] }>("/console/org-units");
  const [unitId, setUnitId] = useState("");
  const { data, error, loading, reload } = useApi<Outcomes>(`/console/placements/outcomes${unitId ? `?unitId=${unitId}` : ""}`);

  async function download() {
    const url = await fetchObjectUrl("/console/placements/outcomes/export");
    const a = document.createElement("a");
    a.href = url;
    a.download = "placement-outcomes.csv";
    a.click();
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <Link href="/console/placements" className="small muted">
            Placements
          </Link>
          <h1 style={{ margin: 0 }}>Placement outcomes</h1>
          <p className="muted" style={{ margin: 0 }}>
            Results of this season&apos;s drives, and how they line up with practice on PlayCode before students applied.
          </p>
        </div>
        <div className="row wrap">
          <select aria-label="Branch or batch" value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ width: "auto" }}>
            <option value="">All students</option>
            {units.data?.units
              .filter((u) => u.kind !== "section")
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
          <button className="btn small" onClick={download}>
            Export (CSV)
          </button>
        </div>
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.registered === 0 ? (
        <div className="card muted">No results yet. They appear as soon as students register for drives and you record the rounds.</div>
      ) : data ? (
        <>
          {data.headline && (
            <div className="card" style={{ background: "var(--accent-soft)", borderColor: "transparent" }}>
              <div className="small muted">Outcome proof</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                Students who practised regularly were placed at {data.headline.regularPct}%, against {data.headline.othersPct}% for everyone else who took part.
              </div>
              <div className="small muted">Regularly means 20 or more practice days in the 60 days before their first registration. It shows a link, not proof of cause: keen students also practise more.</div>
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Stat label="Took part" value={data.registered} sub={`of ${data.students} students`} />
            <Stat label="Placed" value={`${data.placedPct}%`} sub={`${data.placed} students, ${data.offers} offers`} />
            <Stat label="Median CTC" value={data.ctc.median ? formatLpa(data.ctc.median) : "-"} sub={data.ctc.average ? `average ${formatLpa(data.ctc.average)}` : undefined} />
            <Stat label="Highest CTC" value={data.ctc.highest ? formatLpa(data.ctc.highest) : "-"} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Placed, by practice before applying</h2>
              {data.byEngagement.map((b) => (
                <div key={b.id}>
                  <div className="spread small">
                    <span>
                      <b>{b.label}</b> <span className="muted">· {b.detail}</span>
                    </span>
                    <span>
                      {b.placedPct}% <span className="muted">({b.placed} of {b.students})</span>
                    </span>
                  </div>
                  <Bar value={b.placedPct} tone={b.id === "regular" ? "good" : b.id === "occasional" ? "warn" : "bad"} />
                </div>
              ))}
            </div>
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Selected, by readiness when applying</h2>
              {data.byReadiness.map((b) => (
                <div key={b.band}>
                  <div className="spread small">
                    <b>{BAND_LABELS[b.band]}</b>
                    <span>
                      {b.offerPct}% <span className="muted">({b.offers} of {b.applications} decided applications)</span>
                    </span>
                  </div>
                  <Bar value={b.offerPct} tone={b.band === "ready" || b.band === "almost" ? "good" : b.band === "building" ? "warn" : "bad"} />
                </div>
              ))}
              <p className="small muted" style={{ margin: 0 }}>
                Readiness for that kind of company (service or product) on the day the student registered.
              </p>
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            <div className="card" style={{ padding: 0 }}>
              <h2 style={{ margin: 0, padding: "16px 16px 0" }}>By department</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>Students</th>
                      <th>Took part</th>
                      <th>Placed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.departments.map((d) => (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td>{d.students}</td>
                        <td>{d.registered}</td>
                        <td>
                          {d.placed} <span className="muted small">({d.placedPct}%)</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ padding: 0 }}>
              <h2 style={{ margin: 0, padding: "16px 16px 0" }}>By company</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>CTC</th>
                      <th>Registered</th>
                      <th>Offers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.companies.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/console/placements/${c.id}`}>{c.company}</Link>
                          <div className="small muted">{c.roleTitle}</div>
                        </td>
                        <td>{formatLpa(c.ctcRupees)}</td>
                        <td>{c.registered}</td>
                        <td>{c.offers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
