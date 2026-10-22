"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DIVISION_LABELS, type Division } from "@playcode/core";
import { useMe } from "@/components/Auth";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { EventItem } from "@/components/Events";
import { startAndOpen, type StartInput } from "@/lib/start";
import type { ProfileSummary, StudentPath } from "@/lib/types";

interface Home {
  tenant: { name: string };
  profile: ProfileSummary;
  daily: { started: boolean; sessionId: string | null; finished: boolean; correctCount: number; total: number };
  assignments: { id: string; title: string; questionCount: number; closeAt: string; status: string }[];
  league: { division: Division; rank: number | null; groupSize: number; weeklyXp: number; zone: string | null };
  openMistakes: number;
  duelInvites: number;
  tests: { id: string; title: string; state: string; closeAt: string; durationMinutes: number }[];
  suggestedSkill: { id: string; name: string; topicName: string } | null;
}

function dueIn(iso: string): string {
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  if (h < 1) return "due within the hour";
  if (h < 24) return `due in ${h} h`;
  return `due in ${Math.round(h / 24)} d`;
}

export default function PlayHome() {
  const me = useMe();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Home>("/student/home");
  const paths = useApi<{ paths: StudentPath[] }>("/student/paths");
  const events = useApi<{ events: EventItem[] }>("/student/competitions");
  const liveEvent = events.data?.events.find((e) => e.state === "live");
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (input: StartInput) => {
    setBusy(true);
    setStartError(await startAndOpen(input, router.push));
    setBusy(false);
  };

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const p = data.profile;

  return (
    <div className="stack">
      <div>
        <h1>Hi {me.user.name.split(" ")[0]}</h1>
        <p className="muted">
          Level {p.level} {p.title} · {p.needed - p.current} XP to level {p.level + 1}
        </p>
        <Bar value={(p.current / Math.max(1, p.needed)) * 100} />
      </div>

      {p.streak.atRisk && (
        <div className="card row" style={{ background: "var(--warn-soft)", borderColor: "transparent" }}>
          <Icon name="flame" className="stat-streak" />
          <span>
            Answer one question today to keep your <b>{p.streak.days}-day streak</b>.
          </span>
        </div>
      )}
      {startError && <ErrorBox message={startError} />}
      {data.duelInvites > 0 && (
        <button className="card spread" style={{ background: "var(--accent-soft)", borderColor: "transparent", font: "inherit", color: "inherit", cursor: "pointer" }} onClick={() => router.push("/play/duels")}>
          <span className="row">
            <Icon name="bolt" /> <b>{data.duelInvites === 1 ? "A classmate challenged you to a duel" : `${data.duelInvites} duel challenges waiting`}</b>
          </span>
          <Icon name="arrow" />
        </button>
      )}

      <div className="card accent stack">
        <div className="spread">
          <div>
            <h2 style={{ margin: 0 }}>Daily challenge</h2>
            <div className="muted small">5 questions · same for everyone at {data.tenant.name}</div>
          </div>
          <Icon name="bolt" size={32} />
        </div>
        {data.daily.finished ? (
          <p style={{ margin: 0, fontWeight: 600 }}>
            Done for today: {data.daily.correctCount}/{data.daily.total} correct. Come back tomorrow.
          </p>
        ) : (
          <button className="btn big" disabled={busy} onClick={() => start({ kind: "daily" })} style={{ color: "var(--accent)" }}>
            {data.daily.started ? "Continue" : "Start"} daily challenge
          </button>
        )}
      </div>

      {liveEvent && (
        <button className="card spread" style={{ font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }} onClick={() => router.push("/play/league")}>
          <span>
            <span className="pill good">Live event</span> <b>{liveEvent.title}</b>
            <div className="muted small">
              {liveEvent.myTeam ? `${liveEvent.myTeam.name} is #${liveEvent.myTeam.rank} of ${liveEvent.leaderboard.length}. Every XP you earn counts for your team.` : "Earn XP for your team."}
            </div>
          </span>
          <Icon name="arrow" />
        </button>
      )}

      {data.tests.length > 0 && (
        <div className="card stack" style={{ borderColor: "var(--accent)" }}>
          <h2>Tests open now</h2>
          {data.tests.map((t) => (
            <div key={t.id} className="spread">
              <div>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                <div className="muted small">
                  {t.durationMinutes} min · closes {dueIn(t.closeAt).replace("due ", "")}
                </div>
              </div>
              <button className="btn primary small" onClick={() => router.push(`/play/tests/${t.id}`)}>
                {t.state === "in_progress" ? "Resume" : "Open"}
              </button>
            </div>
          ))}
        </div>
      )}

      {paths.data?.paths
        .filter((path) => path.done < path.steps.length)
        .slice(0, 2)
        .map((path) => {
          const next = path.steps.find((s) => s.state === "current" || s.state === "open");
          return (
            <div key={path.id} className="card stack" style={{ gap: 8 }}>
              <div className="spread">
                <h2 style={{ margin: 0 }}>{path.title}</h2>
                <Link href="/play/paths" className="small">
                  {path.done}/{path.steps.length} steps
                </Link>
              </div>
              <Bar value={(path.done / path.steps.length) * 100} tone="good" />
              {next && (
                <div className="spread">
                  <div className="small">
                    Next: <b>{next.title}</b>
                    {next.overdue && <span style={{ color: "var(--bad)" }}> · overdue</span>}
                  </div>
                  <button className="btn primary small" disabled={busy} onClick={() => start(next.kind === "skill" ? { kind: "skill", skillId: next.ref } : { kind: "pack", packId: next.ref })}>
                    Continue
                  </button>
                </div>
              )}
            </div>
          );
        })}

      {data.assignments.length > 0 && (
        <div className="card stack">
          <h2>Assigned to you</h2>
          {data.assignments.map((a) => (
            <div key={a.id} className="spread">
              <div>
                <div style={{ fontWeight: 600 }}>{a.title}</div>
                <div className="muted small">
                  {a.questionCount} questions · {dueIn(a.closeAt)}
                </div>
              </div>
              <button className="btn primary small" disabled={busy} onClick={() => start({ kind: "assignment", assignmentId: a.id })}>
                {a.status === "in_progress" ? "Continue" : "Start"}
              </button>
            </div>
          ))}
        </div>
      )}

      {data.suggestedSkill && (
        <div className="card spread">
          <div>
            <div className="muted small">Suggested next</div>
            <div style={{ fontWeight: 700 }}>{data.suggestedSkill.name}</div>
            <div className="muted small">{data.suggestedSkill.topicName}</div>
          </div>
          <button className="btn primary" disabled={busy || p.hearts === 0} onClick={() => start({ kind: "skill", skillId: data.suggestedSkill!.id })}>
            Practise
          </button>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <button className="card tight stack" style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }} onClick={() => router.push("/play/league")}>
          <span className="muted small">{DIVISION_LABELS[data.league.division]} league</span>
          <span className="kpi">{data.league.rank ? `#${data.league.rank}` : "-"}</span>
          <span className="muted small">{data.league.rank ? `of ${data.league.groupSize} · ${data.league.weeklyXp} XP this week` : "Earn XP to join this week"}</span>
        </button>
        <button
          className="card tight stack"
          style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}
          onClick={() => (data.openMistakes ? start({ kind: "mistakes" }) : router.push("/play/mistakes"))}
        >
          <span className="muted small">Mistakes to review</span>
          <span className="kpi">{data.openMistakes}</span>
          <span className="muted small">{data.openMistakes ? "Fix one to earn a heart" : "All clear"}</span>
        </button>
      </div>
    </div>
  );
}
