"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Bar, ErrorBox, Loading, Stat } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

interface StepProgress {
  stepId: string;
  state: "done" | "current" | "open" | "locked";
  value: number | null;
  dueAt: string | null;
  overdue: boolean;
}

interface Detail {
  path: { id: string; title: string; description: string; sequential: boolean; startsAt: string; status: "active" | "archived" };
  summary: { learners: number; completed: number; overdue: number; steps: { id: string; kind: "skill" | "pack"; title: string; target: number; dueDays: number | null; done: number }[] };
  learners: { id: string; name: string; rollNo: string | null; email: string; steps: StepProgress[]; done: number; overdue: boolean; completed: boolean }[];
}

function Cell({ s }: { s: StepProgress }) {
  if (s.state === "done") return <span className="pill good">Done</span>;
  const text = s.value === null ? (s.overdue ? "Not started" : "-") : `${s.value}%`;
  return <span className={s.overdue ? "pill bad" : s.state === "locked" ? "muted small" : "pill"}>{s.overdue ? `${text}, late` : text}</span>;
}

export default function PathDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Detail>(`/console/paths/${id}`);

  async function download() {
    const url = await fetchObjectUrl(`/console/paths/${id}/export`);
    const a = document.createElement("a");
    a.href = url;
    a.download = "path-progress.csv";
    a.click();
  }

  async function archive() {
    if (!window.confirm("Archive this path? Learners stop seeing it; progress is kept.")) return;
    try {
      await api(`/console/paths/${id}/archive`, { body: {} });
      router.push("/console/paths");
    } catch (e) {
      window.alert(errorMessage(e));
    }
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const { path, summary, learners } = data;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <Link href="/console/paths" className="small muted">
            Learning paths
          </Link>
          <h1 style={{ margin: 0 }}>{path.title}</h1>
          <div className="small muted">
            From {new Date(path.startsAt).toLocaleDateString()} · {path.sequential ? "steps unlock in order" : "any order"}
            {path.status === "archived" && " · archived"}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={download}>
            Export CSV
          </button>
          {path.status === "active" && (
            <button className="btn ghost" onClick={archive}>
              Archive
            </button>
          )}
        </div>
      </div>
      <div className="grid">
        <Stat label="Learners" value={summary.learners} />
        <Stat label="Completed" value={summary.completed} sub={summary.learners ? `${Math.round((summary.completed / summary.learners) * 100)}%` : undefined} />
        <Stat label="Behind schedule" value={summary.overdue} />
        <Stat label="Steps" value={summary.steps.length} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Steps</h2>
        {summary.steps.map((s, i) => (
          <div key={s.id}>
            <div className="spread small">
              <span>
                {i + 1}. {s.title} <span className="muted">({s.kind === "skill" ? `${s.target}% mastery` : `${s.target}% to pass`}{s.dueDays !== null ? `, due day ${s.dueDays}` : ""})</span>
              </span>
              <span className="muted">
                {s.done}/{summary.learners}
              </span>
            </div>
            <Bar value={summary.learners ? (s.done / summary.learners) * 100 : 0} tone="good" />
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Learner</th>
                {summary.steps.map((s, i) => (
                  <th key={s.id} title={s.title}>
                    Step {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {learners.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/console/students/${l.id}`}>{l.name}</Link>
                    <div className="small muted">{l.rollNo ?? l.email}</div>
                  </td>
                  {l.steps.map((s) => (
                    <td key={s.stepId}>
                      <Cell s={s} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
