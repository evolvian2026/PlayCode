"use client";

import Link from "next/link";
import { useState } from "react";
import { WRITING_DIMENSIONS, WRITING_KINDS, type WritingKind } from "@playcode/core";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Data {
  attempts: { id: string; userId: string; name: string; rollNo: string | null; task: string; kind: WritingKind; words: number; overall: number; scores: Record<string, number>; createdAt: string }[];
  averages: ({ count: number; overall: number } & Record<string, number>) | null;
}

const tone = (n: number) => (n >= 4 ? "good" : n === 3 ? "warn" : "bad");

export default function ConsoleWriting() {
  const units = useApi<{ units: { id: string; name: string }[] }>("/console/org-units");
  const [unitId, setUnitId] = useState("");
  const { data, error, loading, reload } = useApi<Data>(`/console/writing${unitId ? `?unitId=${unitId}` : ""}`);
  const avg = data?.averages;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Written English</h1>
          <p className="muted" style={{ margin: 0 }}>
            Emails and essays students wrote against the clock, with the AI's marks on the placement-test rubric. Open one to read it with the corrections.
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
        <div className="card muted">No marked answers yet. Students write them from Written English on their profile.</div>
      ) : (
        <>
          <section className="stack" aria-label="Averages" style={{ gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>
              Averages <span className="muted small">({avg.count})</span>
            </h2>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <Stat label="Average overall" value={`${avg.overall}/5`} />
              {WRITING_DIMENSIONS.map(([key, label]) => (
                <Stat key={key} label={label} value={avg[key] ?? "-"} />
              ))}
            </div>
          </section>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Task</th>
                    <th>Overall</th>
                    <th>Scores</th>
                    <th>Words</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attempts.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/console/writing/${r.id}`}>{r.name}</Link>
                        <div className="small muted">{r.rollNo}</div>
                      </td>
                      <td className="small">
                        {r.task} <span className="muted">· {WRITING_KINDS[r.kind]}</span>
                      </td>
                      <td>
                        <span className={`pill ${tone(r.overall)}`}>{r.overall}/5</span>
                      </td>
                      <td className="small">{WRITING_DIMENSIONS.map(([key, label]) => `${label} ${r.scores[key] ?? "-"}`).join(" · ")}</td>
                      <td className="small">{r.words}</td>
                      <td className="small">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
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
