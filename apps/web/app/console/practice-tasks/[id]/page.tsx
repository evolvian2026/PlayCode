"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PRACTICE_TASK_KINDS, type PracticeTaskKind } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Detail {
  task: { id: string; kind: PracticeTaskKind; subject: string | null; note: string | null; openAt: string; closeAt: string };
  students: { id: string; name: string; rollNo: string | null; done: { at: string; score: number; outOf: 5 | 100; attemptId: string } | null }[];
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function PracticeTask() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Detail>(`/console/practice-tasks/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const { task, students } = data;
  const done = students.filter((s) => s.done).length;
  // JAM talks and writing open in their own console pages; drills are summarised on Speaking practice.
  const attemptHref = (attemptId: string) => (task.kind === "jam" ? `/console/speaking/${attemptId}` : task.kind === "writing" ? `/console/writing/${attemptId}` : null);

  async function remove() {
    if (!confirm("Delete this task? Students' attempts stay; only the task goes.")) return;
    try {
      await api(`/console/practice-tasks/${id}`, { method: "DELETE" });
      router.push("/console/practice-tasks");
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <Link href="/console/practice-tasks" className="small muted">
          Speaking and writing tasks
        </Link>
        <h1 style={{ margin: 0 }}>
          {PRACTICE_TASK_KINDS[task.kind]}
          {task.subject && `: ${task.subject}`}
        </h1>
        <div className="small muted">
          {fmt(task.openAt)} to {fmt(task.closeAt)} · {done} of {students.length} done
        </div>
        {task.note && <p style={{ margin: "6px 0 0" }}>{task.note}</p>}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Done</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const href = s.done && attemptHref(s.done.attemptId);
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/console/students/${s.id}`}>{s.name}</Link>
                      <div className="small muted">{s.rollNo}</div>
                    </td>
                    <td className="small">{s.done ? fmt(s.done.at) : <span className="pill warn">Not yet</span>}</td>
                    <td className="small">
                      {s.done ? href ? <Link href={href}>{s.done.outOf === 5 ? `${s.done.score}/5` : `${s.done.score}%`}</Link> : `${s.done.score}%` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {actionError && <ErrorBox message={actionError} />}
      <div>
        <button className="btn ghost small" onClick={remove}>
          Delete task
        </button>
      </div>
    </div>
  );
}
