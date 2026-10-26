"use client";

import Link from "next/link";
import { useState } from "react";
import { GD_DIMENSIONS, type GdParticipation } from "@playcode/core";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Data {
  discussions: { id: string; userId: string; name: string; rollNo: string | null; topic: string; overall: number; scores: Record<string, number>; participation: GdParticipation; finishedAt: string }[];
  averages: ({ count: number; overall: number; sharePct: number } & Record<string, number>) | null;
}

const tone = (n: number) => (n >= 4 ? "good" : n === 3 ? "warn" : "bad");

export default function ConsoleGds() {
  const units = useApi<{ units: { id: string; name: string }[] }>("/console/org-units");
  const [unitId, setUnitId] = useState("");
  const { data, error, loading, reload } = useApi<Data>(`/console/gd${unitId ? `?unitId=${unitId}` : ""}`);
  const avg = data?.averages;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Group discussions</h1>
          <p className="muted" style={{ margin: 0 }}>
            Practice GDs students took with AI participants, with their scorecards and how much they took part. Open one to read the discussion.
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
      ) : !avg ? (
        <div className="card muted">No scored group discussions yet. Students start them from Mock interviews or their profile.</div>
      ) : (
        <>
          <section className="stack" aria-label="Averages" style={{ gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>
              Averages <span className="muted small">({avg.count})</span>
            </h2>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <Stat label="Average overall" value={`${avg.overall}/5`} />
              {GD_DIMENSIONS.map(([key, label]) => (
                <Stat key={key} label={label} value={avg[key] ?? "-"} />
              ))}
              <Stat label="Share of words" value={`${avg.sharePct}%`} />
            </div>
          </section>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Topic</th>
                    <th>Overall</th>
                    <th>Scores</th>
                    <th>Took part</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.discussions.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/console/gd/${r.id}`}>{r.name}</Link>
                        <div className="small muted">{r.rollNo}</div>
                      </td>
                      <td className="small">{r.topic}</td>
                      <td>
                        <span className={`pill ${tone(r.overall)}`}>{r.overall}/5</span>
                      </td>
                      <td className="small">{GD_DIMENSIONS.map(([key, label]) => `${label} ${r.scores[key] ?? "-"}`).join(" · ")}</td>
                      <td className="small">
                        {r.participation.contributions} turns, {r.participation.sharePct}% of words
                        {r.participation.initiated ? ", opened" : ""}
                        {r.participation.summarised ? ", summarised" : ""}
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
