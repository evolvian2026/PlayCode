"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Row {
  id: string;
  userId: string;
  name: string;
  rollNo: string | null;
  track: "service" | "product";
  overall: number;
  scores: { problemSolving: number; fundamentals: number; communication: number; code: number };
  finishedAt: string;
}

interface Data {
  interviews: Row[];
  averages: { overall: number; problemSolving: number; fundamentals: number; communication: number; code: number } | null;
}

const tone = (n: number) => (n >= 4 ? "good" : n === 3 ? "warn" : "bad");

export default function ConsoleInterviews() {
  const units = useApi<{ units: { id: string; name: string }[] }>("/console/org-units");
  const [unitId, setUnitId] = useState("");
  const { data, error, loading, reload } = useApi<Data>(`/console/interviews${unitId ? `?unitId=${unitId}` : ""}`);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Mock interviews</h1>
          <p className="muted" style={{ margin: 0 }}>
            Practice interviews students took with the AI interviewer, with their scorecards. Open one to read the transcript.
          </p>
        </div>
        <select aria-label="Batch or section" value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ width: "auto" }}>
          <option value="">Everyone in your scope</option>
          {units.data?.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.averages ? (
        <div className="card muted">No scored interviews yet. Students start them from Placements or their profile.</div>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <Stat label="Interviews" value={data.interviews.length} />
            <Stat label="Average overall" value={`${data.averages.overall}/5`} />
            <Stat label="Problem solving" value={data.averages.problemSolving} />
            <Stat label="Fundamentals" value={data.averages.fundamentals} />
            <Stat label="Communication" value={data.averages.communication} />
            <Stat label="Code" value={data.averages.code} />
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Kind</th>
                    <th>Overall</th>
                    <th>Problem solving</th>
                    <th>Fundamentals</th>
                    <th>Communication</th>
                    <th>Code</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.interviews.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/console/interviews/${r.id}`}>{r.name}</Link>
                        <div className="small muted">{r.rollNo}</div>
                      </td>
                      <td className="small">{r.track === "product" ? "Product" : "Service"}</td>
                      <td>
                        <span className={`pill ${tone(r.overall)}`}>{r.overall}/5</span>
                      </td>
                      <td>{r.scores.problemSolving}</td>
                      <td>{r.scores.fundamentals}</td>
                      <td>{r.scores.communication}</td>
                      <td>{r.scores.code}</td>
                      <td className="small">{new Date(r.finishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
