"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatLpa } from "@playcode/core";
import { api, API_URL } from "@/lib/api";

interface Batch {
  year: number;
  inProgress: boolean;
  graduating: number;
  placed: number;
  placedPct: number;
  higherStudies: number;
  startup: number;
  medianCtc: number | null;
  highestCtc: number | null;
  departments: { department: string; graduating: number; placedPct: number; medianCtc: number | null }[];
  departmentsHidden: number;
  recruiters: string[];
}
interface PublicRecord {
  institution: string;
  logoUrl: string | null;
  primaryColor: string | null;
  asOf: string;
  minGroup: number;
  batches: Batch[];
}

/** An institution's placement results, published by the institution: totals only, no student named. */
export default function PublicRecordPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicRecord | null | "missing">(null);
  useEffect(() => {
    api<PublicRecord>(`/public/placements/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch(() => setData("missing"));
  }, [slug]);

  if (data === null) return <p className="muted center" style={{ paddingTop: 80 }}>Loading...</p>;
  if (data === "missing") {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 16px" }} className="card">
        <h1>Not published</h1>
        <p className="muted">This institution hasn&apos;t published its placement results here.</p>
      </main>
    );
  }
  const asOf = new Date(`${data.asOf}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "40px 16px" }} className="stack">
      <header className="row" style={{ gap: 14 }}>
        {data.logoUrl && <img src={`${API_URL}${data.logoUrl}`} alt="" width={56} height={56} style={{ objectFit: "contain", borderRadius: 8 }} />}
        <div>
          <h1 style={{ margin: 0 }}>{data.institution}</h1>
          <div className="muted">Placement results, as of {asOf}</div>
        </div>
      </header>
      {data.batches.length === 0 && <div className="card muted">No results to show yet.</div>}
      {data.batches.map((b) => (
        <section key={b.year} className="card stack" aria-labelledby={`h-${b.year}`}>
          <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
            <h2 id={`h-${b.year}`} style={{ margin: 0 }}>
              Batch of {b.year}
            </h2>
            {b.inProgress && <span className="pill accent">Season in progress</span>}
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            {(
              [
                [`${b.placedPct}%`, `placed (${b.placed} of ${b.graduating})`],
                [b.medianCtc ? formatLpa(b.medianCtc) : "-", "median package"],
                [b.highestCtc ? formatLpa(b.highestCtc) : "-", "highest package"],
                [String(b.higherStudies), "went on to higher studies"],
              ] as [string, string][]
            ).map(([v, label]) => (
              <div key={label}>
                <div style={{ fontSize: 26, fontWeight: 700, color: data.primaryColor ?? undefined }}>{v}</div>
                <div className="small muted">{label}</div>
              </div>
            ))}
          </div>
          {b.departments.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Graduating</th>
                    <th>Placed</th>
                    <th>Median package</th>
                  </tr>
                </thead>
                <tbody>
                  {b.departments.map((d) => (
                    <tr key={d.department}>
                      <td>{d.department}</td>
                      <td>{d.graduating}</td>
                      <td>{d.placedPct}%</td>
                      <td>{d.medianCtc ? formatLpa(d.medianCtc) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {b.departmentsHidden > 0 && (
            <div className="small muted">
              {b.departmentsHidden} smaller department{b.departmentsHidden === 1 ? " is" : "s are"} counted in the totals but not shown on their own (fewer than {data.minGroup} graduates).
            </div>
          )}
          {b.recruiters.length > 0 && (
            <div>
              <div className="small muted">Hired by</div>
              <div>{b.recruiters.join(" · ")}</div>
            </div>
          )}
        </section>
      ))}
      <p className="small muted">
        Placed: graduates with a campus offer they didn&apos;t decline, or an off-campus offer the placement cell verified. Each graduate counts once. Published by {data.institution} with PlayCode.
      </p>
    </main>
  );
}
