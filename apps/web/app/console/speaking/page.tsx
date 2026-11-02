"use client";

import Link from "next/link";
import { useState } from "react";
import { JAM_DIMENSIONS, PACE_RANGE } from "@playcode/core";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Data {
  attempts: { id: string; userId: string; name: string; rollNo: string | null; topic: string; words: number; wpm: number; fillersPer100Words: number; usedPct: number; overall: number; scores: Record<string, number>; createdAt: string }[];
  averages: ({ count: number; students: number; overall: number; wpm: number; fillersPer100Words: number } & Record<string, number>) | null;
}

const tone = (n: number) => (n >= 4 ? "good" : n === 3 ? "warn" : "bad");

interface Drills {
  students: { userId: string; name: string; rollNo: string | null; sittings: number; lastAt: string; read: { latest: number; best: number } | null; repeat: { latest: number; best: number } | null }[];
  averages: { students: number; sittings: number; read: number | null; repeat: number | null } | null;
}

const pct = (x: { latest: number; best: number } | null) => (x ? `${x.latest}% (best ${x.best}%)` : "-");

/** Read-aloud and repeat drills: each student's latest and best. */
function DrillsSection({ unitId }: { unitId: string }) {
  const { data, error, reload } = useApi<Drills>(`/console/speaking-drills${unitId ? `?unitId=${unitId}` : ""}`);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return null;
  return (
    <section className="stack" aria-label="Speaking drills" style={{ gap: 8 }}>
      <h2 style={{ margin: 0 }}>Speaking drills</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Read aloud and listen-and-repeat, scored by the share of each sentence&apos;s words the speech recogniser heard: a rough measure of clarity, like the automated tests (Versant, SVAR) some recruiters use. 85% and above is clear; under 60% is hard to follow.
      </p>
      {!data.averages ? (
        <div className="card muted">No drills yet.</div>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <Stat label="Students" value={data.averages.students} sub={`${data.averages.sittings} ${data.averages.sittings === 1 ? "sitting" : "sittings"}`} />
            <Stat label="Read aloud (latest, average)" value={data.averages.read === null ? "-" : `${data.averages.read}%`} />
            <Stat label="Listen and repeat (latest, average)" value={data.averages.repeat === null ? "-" : `${data.averages.repeat}%`} />
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Read aloud</th>
                    <th>Listen and repeat</th>
                    <th>Sittings</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.userId}>
                      <td>
                        <Link href={`/console/students/${s.userId}`}>{s.name}</Link>
                        <div className="small muted">{s.rollNo}</div>
                      </td>
                      <td className="small">{pct(s.read)}</td>
                      <td className="small">{pct(s.repeat)}</td>
                      <td className="small">{s.sittings}</td>
                      <td className="small">{new Date(s.lastAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default function ConsoleSpeaking() {
  const units = useApi<{ units: { id: string; name: string }[] }>("/console/org-units");
  const [unitId, setUnitId] = useState("");
  const { data, error, loading, reload } = useApi<Data>(`/console/jam${unitId ? `?unitId=${unitId}` : ""}`);
  const avg = data?.averages;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Speaking practice</h1>
          <p className="muted" style={{ margin: 0 }}>
            One-minute JAM talks: what students said (as their browser heard it), the AI&apos;s marks, and delivery measured from the transcript. Below them, the read-aloud and repeat drills. No audio is recorded.
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
        <div className="card muted">No JAM talks yet. Students find Speaking practice on their profile.</div>
      ) : (
        <>
          <section className="stack" aria-label="Averages" style={{ gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>
              Averages{" "}
              <span className="muted small">
                ({avg.count} {avg.count === 1 ? "talk" : "talks"} by {avg.students} {avg.students === 1 ? "student" : "students"})
              </span>
            </h2>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <Stat label="Average overall" value={`${avg.overall}/5`} />
              {JAM_DIMENSIONS.map(([key, label]) => (
                <Stat key={key} label={label} value={avg[key] ?? "-"} />
              ))}
              <Stat label="Words a minute" value={avg.wpm} sub={`comfortable: ${PACE_RANGE.min}-${PACE_RANGE.max}`} />
              <Stat label="Fillers per 100 words" value={avg.fillersPer100Words} sub="3 or more is a habit to work on" />
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
                    <th>Pace</th>
                    <th>Fillers</th>
                    <th>Minute used</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attempts.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/console/speaking/${r.id}`}>{r.name}</Link>
                        <div className="small muted">{r.rollNo}</div>
                      </td>
                      <td className="small">{r.topic}</td>
                      <td>
                        <span className={`pill ${tone(r.overall)}`}>{r.overall}/5</span>
                      </td>
                      <td className="small">{JAM_DIMENSIONS.map(([key, label]) => `${label} ${r.scores[key] ?? "-"}`).join(" · ")}</td>
                      <td className="small">{r.wpm} wpm</td>
                      <td className="small">{r.fillersPer100Words}</td>
                      <td className="small">{r.usedPct}%</td>
                      <td className="small">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <DrillsSection unitId={unitId} />
    </div>
  );
}
