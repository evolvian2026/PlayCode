"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { QUESTION_TYPE_LABELS, type QuestionType } from "@playcode/core";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, formatDate, Loading, masteryTone } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Report {
  assignment: { id: string; title: string; openAt: string; closeAt: string; questionCount: number };
  remedial: { skills: { id: string; name: string }[]; below: number; avgBefore: number; avgNow: number; improved: number; reachedTarget: number } | null;
  students: { id: string; name: string; rollNo: string | null; status: "not_started" | "in_progress" | "completed"; score: number | null; masteryBefore?: number; masteryNow?: number }[];
  items: { number: number; questionId: string; stem: string; type: QuestionType | null; answered: number; correctPct: number | null }[];
}

const STATUS = { not_started: ["Not started", "bad"], in_progress: ["In progress", "warn"], completed: ["Completed", "good"] } as const;

export default function AssignmentReport() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Report>(`/console/assignments/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const done = data.students.filter((s) => s.status === "completed").length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Link href="/console/assignments" className="small">
        <Icon name="back" size={16} /> Assignments
      </Link>
      <div>
        <h1 style={{ margin: 0 }}>{data.assignment.title}</h1>
        <p className="muted">
          {data.assignment.questionCount} questions · {formatDate(data.assignment.openAt)} to {formatDate(data.assignment.closeAt)} · {done}/{data.students.length} completed
        </p>
      </div>
      {data.remedial && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Catch-up progress</h2>
          <p className="muted small" style={{ margin: 0 }}>
            For students below {data.remedial.below}% on {data.remedial.skills.map((s) => s.name).join(", ")} when it was set. Mastery is measured on all their practice of those skills, not just this assignment.
          </p>
          <div className="grid">
            <div>
              <div className="muted small">Average mastery</div>
              <div className="kpi">
                {data.remedial.avgBefore}% → {data.remedial.avgNow}%
              </div>
            </div>
            <div>
              <div className="muted small">Improved</div>
              <div className="kpi">
                {data.remedial.improved}/{data.students.length}
              </div>
            </div>
            <div>
              <div className="muted small">Now at {data.remedial.below}% or more</div>
              <div className="kpi">
                {data.remedial.reachedTarget}/{data.students.length}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Question analysis</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Lowest scores first: these are the concepts to revisit in class.
          </p>
          {[...data.items]
            .sort((a, b) => (a.correctPct ?? 101) - (b.correctPct ?? 101))
            .map((i) => (
              <div key={i.questionId}>
                <div className="spread small">
                  <span>
                    <b>Q{i.number}</b> {i.stem} <span className="muted">· {i.type ? QUESTION_TYPE_LABELS[i.type] : ""}</span>
                  </span>
                  <span className="muted" style={{ whiteSpace: "nowrap" }}>
                    {i.correctPct === null ? "no answers" : `${i.correctPct}% right`}
                  </span>
                </div>
                <Bar value={i.correctPct ?? 0} tone={masteryTone(i.correctPct ?? 0)} />
              </div>
            ))}
        </div>
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
                <th>Score</th>
                {data.remedial && <th>Mastery</th>}
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/console/students/${s.id}`}>{s.name}</Link> <span className="muted small">{s.rollNo}</span>
                  </td>
                  <td>
                    <span className={`pill ${STATUS[s.status][1]}`}>{STATUS[s.status][0]}</span>
                  </td>
                  <td>{s.score === null ? "-" : `${s.score}%`}</td>
                  {data.remedial && (
                    <td className="small">
                      {s.masteryBefore}% → {s.masteryNow}%
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
