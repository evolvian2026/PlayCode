"use client";

import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
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
}
interface Scores {
  students: Row[];
  summary: { students: number; tested: number; average: number | null; bands: Record<string, number> };
}

const BANDS: [string, string][] = [
  ["strong", "Strong (650+)"],
  ["good", "Good (525–645)"],
  ["developing", "Developing (400–520)"],
  ["needs_work", "Needs work (below 400)"],
];

export default function AptitudeScores() {
  const { data, error, loading, reload } = useApi<Scores>("/console/aptitude");
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const s = data.summary;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
      <div>
        <h1 style={{ margin: 0 }}>Aptitude scores</h1>
        <p className="muted" style={{ margin: 0 }}>
          Each student&apos;s latest adaptive aptitude test, scored 100 to 900 (500 is average), for quantitative ability and logical reasoning. Students take it from Mock tests in the app, as often as they like; questions are made fresh each time, so a retake isn&apos;t a memory test.
        </p>
      </div>
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
              <th scope="col">Score</th>
              <th scope="col">Quantitative</th>
              <th scope="col">Reasoning</th>
              <th scope="col">Taken</th>
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
                <td className="small">{r.at ? new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
