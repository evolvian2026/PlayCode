"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DIVISION_LABELS } from "@playcode/core";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, formatDate, Loading, masteryTone, Stat, timeAgo } from "@/components/ui";
import { fetchObjectUrl, useApi } from "@/lib/api";
import type { StudentDetail } from "@/lib/types";

const KIND_LABELS: Record<string, string> = { skill: "Practice", daily: "Daily challenge", pack: "Mission", assignment: "Assignment", mistakes: "Mistake review" };

async function downloadResume(id: string, name: string) {
  const url = await fetchObjectUrl(`/console/students/${id}/resume.pdf`);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w]+/g, "-").toLowerCase()}-resume.pdf`;
  a.click();
}

export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<StudentDetail>(`/console/students/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Link href="/console/students" className="small">
        <Icon name="back" size={16} /> Students
      </Link>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>{data.user.name}</h1>
          <p className="muted">
            {data.user.rollNo} · {data.user.email} · last active {timeAgo(data.user.lastActiveAt)}
          </p>
        </div>
        <button className="btn small" onClick={() => downloadResume(id, data.user.name)}>
          Resume (PDF)
        </button>
      </div>
      <div className="grid">
        <Stat label="Level" value={data.level} sub={`${data.title} · ${data.xp} XP`} />
        <Stat label="Streak" value={data.streak} sub={`best ${data.longestStreak} days`} />
        <Stat label="Correct answers" value={data.correctAnswers} sub={`${data.openMistakes} mistakes open`} />
        <Stat label="League" value={DIVISION_LABELS[data.division]} sub={`${data.badges.length} badges`} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Readiness</h2>
          {data.readiness.map((r) => (
            <div key={r.id}>
              <div className="spread small">
                <b>{r.name}</b>
                <span>{r.score}/100</span>
              </div>
              <Bar value={r.score} tone={masteryTone(r.score)} />
            </div>
          ))}
          <h3 style={{ marginTop: 8 }}>Badges</h3>
          <div className="row wrap">
            {data.badges.length ? data.badges.map((b) => <span key={b.code} className="pill accent" title={b.description}>{b.name}</span>) : <span className="muted small">None yet</span>}
          </div>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Recent sessions</h2>
          {data.recentSessions.length === 0 ? (
            <p className="muted">No practice yet.</p>
          ) : (
            <table>
              <tbody>
                {data.recentSessions.map((s) => (
                  <tr key={s.id}>
                    <td>{KIND_LABELS[s.kind] ?? s.kind}</td>
                    <td className="muted small">{formatDate(s.startedAt)}</td>
                    <td>
                      {s.correctCount}/{s.total}
                      {!s.finished && <span className="muted small"> (in progress)</span>}
                    </td>
                    <td className="stat-xp">+{s.xpEarned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Skill mastery</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Skill</th>
                <th style={{ width: "35%" }}>Mastery</th>
                <th>Attempts</th>
                <th>Accuracy</th>
                <th>Last practised</th>
              </tr>
            </thead>
            <tbody>
              {data.skills.map((s) => (
                <tr key={s.skillId}>
                  <td>
                    {s.name} <span className="muted small">· {s.topicName}</span>
                  </td>
                  <td>
                    <div className="row">
                      <div style={{ flex: 1 }}>
                        <Bar value={s.mastery} tone={masteryTone(s.mastery)} />
                      </div>
                      <span className="small">{s.mastery}%</span>
                    </div>
                  </td>
                  <td>{s.attempts}</td>
                  <td>{s.accuracyPct === null ? "-" : `${s.accuracyPct}%`}</td>
                  <td className="muted small">{s.lastPractisedAt ?? "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
