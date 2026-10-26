"use client";

import Link from "next/link";
import { useState } from "react";
import { HR_DIMENSIONS, INTERVIEW_TRACK_LABELS, interviewDimensions, TECHNICAL_DIMENSIONS, type InterviewTrack } from "@playcode/core";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Row {
  id: string;
  userId: string;
  name: string;
  rollNo: string | null;
  track: InterviewTrack;
  mode: "text" | "voice";
  overall: number;
  scores: Record<string, number>;
  finishedAt: string;
}

interface Data {
  interviews: Row[];
  averages: Averages | null;
  hrAverages: Averages | null;
}

type Averages = { count: number; overall: number } & Record<string, number>;

function AverageStats({ title, avg, dims }: { title: string; avg: Averages; dims: readonly (readonly [string, string])[] }) {
  return (
    <section className="stack" aria-label={title} style={{ gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: "1rem" }}>
        {title} <span className="muted small">({avg.count})</span>
      </h2>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Stat label="Average overall" value={`${avg.overall}/5`} />
        {dims.map(([key, label]) => (
          <Stat key={key} label={label} value={avg[key] ?? "-"} />
        ))}
      </div>
    </section>
  );
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
      ) : !data?.averages && !data?.hrAverages ? (
        <div className="card muted">No scored interviews yet. Students start them from Placements or their profile.</div>
      ) : (
        <>
          {data.averages && <AverageStats title="Technical rounds" avg={data.averages} dims={TECHNICAL_DIMENSIONS} />}
          {data.hrAverages && <AverageStats title="HR rounds" avg={data.hrAverages} dims={HR_DIMENSIONS} />}
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Kind</th>
                    <th>Overall</th>
                    <th>Scores</th>
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
                      <td className="small">
                        {INTERVIEW_TRACK_LABELS[r.track]}
                        {r.mode === "voice" ? " · spoken" : ""}
                      </td>
                      <td>
                        <span className={`pill ${tone(r.overall)}`}>{r.overall}/5</span>
                      </td>
                      <td className="small">
                        {interviewDimensions(r.track)
                          .map(([key, label]) => `${label} ${r.scores[key] ?? "-"}`)
                          .join(" · ")}
                      </td>
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
