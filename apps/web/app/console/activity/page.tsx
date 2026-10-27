"use client";

import { useState } from "react";
import { academicYearOf, formatLpa, localDate, TRAINING_KINDS, type TrainingKind } from "@playcode/core";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { UnitPicker } from "@/components/UnitPicker";
import { errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

interface Report {
  institution: string;
  scope: string;
  from: string;
  to: string;
  students: number;
  training: {
    sessions: { id: string; date: string; title: string; kind: TrainingKind; trainer: string; location: string; hours: number; invited: number; attended: number; pct: number }[];
    byKind: { kind: TrainingKind; label: string; sessions: number; hours: number }[];
    totals: { sessions: number; hours: number; studentsTrained: number; studentsTrainedPct: number; attendancePct: number | null };
  };
  classTests: { paperId: string; title: string; date: string; students: number; averagePct: number }[];
  practice: Record<"answers" | "mockTests" | "mockInterviews" | "groupDiscussions" | "writing", { count: number; students: number }>;
  placements: { companies: { company: string; roleTitle: string; date: string; ctcRupees: number; registered: number; offers: number }[]; registered: number; placed: number; offers: number; highest: number | null; median: number | null };
}

const PRACTICE: [keyof Report["practice"], string][] = [
  ["answers", "Practice answers"],
  ["mockTests", "Timed mock tests"],
  ["mockInterviews", "AI mock interviews"],
  ["groupDiscussions", "Group discussions"],
  ["writing", "Written English answers"],
];

/** The current academic year and the three before it. */
function years() {
  const current = academicYearOf(localDate(new Date()));
  const start = Number(current.slice(0, 4));
  return [0, 1, 2, 3].map((i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, "0")}`);
}

export default function ActivityReport() {
  const [year, setYear] = useState(years()[0]!);
  const [unitId, setUnitId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const query = `year=${year}${unitId ? `&unitId=${unitId}` : ""}`;
  const { data, error, loading, reload } = useApi<Report>(`/console/activity-report?${query}`);

  async function download(format: "csv" | "pdf") {
    setBusy(format);
    setMsg(null);
    try {
      const url = await fetchObjectUrl(`/console/activity-report?${query}&format=${format}`);
      const a = document.createElement("a");
      a.href = url;
      a.download = `training-placement-activity-${year}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Training and placement report</h1>
          <p className="muted" style={{ margin: 0 }}>
            For accreditation (NAAC, NBA) and management reviews: training held, attendance, class tests, practice and placements for an academic year (June to May).
          </p>
        </div>
        <div className="row wrap">
          <select aria-label="Academic year" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: "auto" }}>
            {years().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <UnitPicker value={unitId} onChange={setUnitId} allLabel="All students in my scope" />
        </div>
      </div>
      <div className="row wrap">
        <button className="btn primary" disabled={busy !== null || !data} onClick={() => download("pdf")}>
          {busy === "pdf" ? "Preparing..." : "Download PDF"}
        </button>
        <button className="btn" disabled={busy !== null || !data} onClick={() => download("csv")}>
          {busy === "csv" ? "Preparing..." : "Download CSV"}
        </button>
        {msg && <ErrorBox message={msg} />}
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="small muted">
            {data.scope} · {data.from} to {data.to} · {data.students} students
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Stat label="Training sessions" value={data.training.totals.sessions} sub={`${data.training.totals.hours} hours`} />
            <Stat label="Students trained" value={`${data.training.totals.studentsTrainedPct}%`} sub={`${data.training.totals.studentsTrained} of ${data.students}`} />
            <Stat label="Average attendance" value={data.training.totals.attendancePct === null ? "-" : `${data.training.totals.attendancePct}%`} />
            <Stat label="Class tests" value={data.classTests.length} />
            <Stat label="Students placed" value={data.placements.placed} sub={`${data.placements.offers} offers`} />
            <Stat label="Highest package" value={data.placements.highest ? formatLpa(data.placements.highest) : "-"} sub={data.placements.median ? `median ${formatLpa(data.placements.median)}` : undefined} />
          </div>

          <div className="card" style={{ padding: 0 }}>
            <h2 style={{ margin: 0, padding: "12px 16px" }}>Training sessions</h2>
            {data.training.sessions.length === 0 ? (
              <p className="muted" style={{ padding: "0 16px 12px", margin: 0 }}>
                No sessions in this period.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Session</th>
                      <th>Trainer</th>
                      <th>Hours</th>
                      <th>Attended</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.training.sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="small">{s.date}</td>
                        <td>
                          {s.title}
                          <div className="small muted">
                            {TRAINING_KINDS[s.kind]} · {s.location}
                          </div>
                        </td>
                        <td className="small">{s.trainer}</td>
                        <td>{s.hours}</td>
                        <td>
                          {s.attended} of {s.invited} <span className="small muted">({s.pct}%)</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Class tests</h2>
              {data.classTests.length === 0 ? (
                <div className="small muted">No class test results in this period.</div>
              ) : (
                data.classTests.map((c) => (
                  <div key={c.paperId} className="spread small">
                    <span>
                      {c.title} <span className="muted">· {c.date}</span>
                    </span>
                    <span>
                      {c.students} students · {c.averagePct}% average
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Practice on PlayCode</h2>
              {PRACTICE.map(([key, label]) => (
                <div key={key} className="spread small">
                  <span>{label}</span>
                  <span>
                    {data.practice[key].count.toLocaleString("en-IN")} <span className="muted">
                      by {data.practice[key].students} student{data.practice[key].students === 1 ? "" : "s"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <h2 style={{ margin: 0, padding: "12px 16px" }}>Placement drives</h2>
            {data.placements.companies.length === 0 ? (
              <p className="muted" style={{ padding: "0 16px 12px", margin: 0 }}>
                No drives with registrations in this period.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Company</th>
                      <th>Package</th>
                      <th>Registered</th>
                      <th>Offers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.placements.companies.map((c) => (
                      <tr key={`${c.company}-${c.date}`}>
                        <td className="small">{c.date}</td>
                        <td>
                          {c.company} <div className="small muted">{c.roleTitle}</div>
                        </td>
                        <td>{formatLpa(c.ctcRupees)}</td>
                        <td>{c.registered}</td>
                        <td>{c.offers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
