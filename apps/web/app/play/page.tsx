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
import { useLocale, useT, type Translate } from "@/lib/i18n";

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

/** "in 5 h", "in 2 d": how long until a deadline. */
function timeLeft(iso: string, t: Translate): string {
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  if (h < 1) return t("within the hour");
  if (h < 24) return t("in {n} h", { n: h });
  return t("in {n} d", { n: Math.round(h / 24) });
}

interface PlacementDrive {
  id: string;
  company: string;
  registerBy: string;
  open: boolean;
  eligibility: { eligible: boolean };
  application: { status: string } | null;
}

/** Drives the student can still register for, and how many of their applications are in progress. */
function PlacementCard({ drives }: { drives: PlacementDrive[] }) {
  const t = useT();
  const locale = useLocale();
  const open = drives.filter((d) => d.open && d.eligibility.eligible && !d.application).sort((a, b) => a.registerBy.localeCompare(b.registerBy));
  const inProgress = drives.filter((d) => d.application?.status === "registered" || d.application?.status === "shortlisted").length;
  if (open.length === 0 && inProgress === 0) return null;
  return (
    <Link href="/play/placements" className="card spread" style={{ color: "inherit" }}>
      <div>
        <div className="muted small">{t("Placements")}</div>
        <b>{open.length ? t("{n} drives open for you", { n: open.length }) : t("{n} applications in progress", { n: inProgress })}</b>
        {open[0] && (
          <div className="small muted">
            {t("Next: {company}, register by {when}", { company: open[0].company, when: new Date(open[0].registerBy).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" }) })}
          </div>
        )}
      </div>
      <Icon name="briefcase" />
    </Link>
  );
}

export default function PlayHome() {
  const me = useMe();
  const t = useT();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Home>("/student/home");
  const paths = useApi<{ paths: StudentPath[] }>("/student/paths");
  const events = useApi<{ events: EventItem[] }>("/student/competitions");
  const placements = useApi<{ drives: PlacementDrive[] }>("/student/placements");
  const interviews = useApi<{ available: boolean; active: string | null }>("/student/interviews");
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
        <h1>{t("Hi {name}", { name: me.user.name.split(" ")[0]! })}</h1>
        <p className="muted">{t("Level {level} {title} · {n} XP to level {next}", { level: p.level, title: p.title, n: p.needed - p.current, next: p.level + 1 })}</p>
        <Bar value={(p.current / Math.max(1, p.needed)) * 100} />
      </div>

      {p.streak.atRisk && (
        <div className="card row" style={{ background: "var(--warn-soft)", borderColor: "transparent" }}>
          <Icon name="flame" className="stat-streak" />
          <span>{t("Answer one question today to keep your {n}-day streak.", { n: p.streak.days })}</span>
        </div>
      )}
      {startError && <ErrorBox message={startError} />}
      {data.duelInvites > 0 && (
        <button className="card spread" style={{ background: "var(--accent-soft)", borderColor: "transparent", font: "inherit", color: "inherit", cursor: "pointer" }} onClick={() => router.push("/play/duels")}>
          <span className="row">
            <Icon name="bolt" /> <b>{data.duelInvites === 1 ? t("A classmate challenged you to a duel") : t("{n} duel challenges waiting", { n: data.duelInvites })}</b>
          </span>
          <Icon name="arrow" />
        </button>
      )}

      <div className="card accent stack">
        <div className="spread">
          <div>
            <h2 style={{ margin: 0 }}>{t("Daily challenge")}</h2>
            <div className="muted small">{t("5 questions · same for everyone at {org}", { org: data.tenant.name })}</div>
          </div>
          <Icon name="bolt" size={32} />
        </div>
        {data.daily.finished ? (
          <p style={{ margin: 0, fontWeight: 600 }}>{t("Done for today: {correct}/{total} correct. Come back tomorrow.", { correct: data.daily.correctCount, total: data.daily.total })}</p>
        ) : (
          <button className="btn big" disabled={busy} onClick={() => start({ kind: "daily" })} style={{ color: "var(--accent)" }}>
            {t(data.daily.started ? "Continue daily challenge" : "Start daily challenge")}
          </button>
        )}
      </div>

      {liveEvent && (
        <button className="card spread" style={{ font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }} onClick={() => router.push("/play/league")}>
          <span>
            <span className="pill good">{t("Live event")}</span> <b>{liveEvent.title}</b>
            <div className="muted small">
              {liveEvent.myTeam
                ? t("{team} is #{rank} of {count}. Every XP you earn counts for your team.", { team: liveEvent.myTeam.name, rank: liveEvent.myTeam.rank, count: liveEvent.leaderboard.length })
                : t("Earn XP for your team.")}
            </div>
          </span>
          <Icon name="arrow" />
        </button>
      )}

      {data.tests.length > 0 && (
        <div className="card stack" style={{ borderColor: "var(--accent)" }}>
          <h2>{t("Tests open now")}</h2>
          {data.tests.map((test) => (
            <div key={test.id} className="spread">
              <div>
                <div style={{ fontWeight: 600 }}>{test.title}</div>
                <div className="muted small">
                  {t("{min} min · closes {when}", { min: test.durationMinutes, when: timeLeft(test.closeAt, t) })}
                </div>
              </div>
              <button className="btn primary small" onClick={() => router.push(`/play/tests/${test.id}`)}>
                {t(test.state === "in_progress" ? "Resume" : "Open")}
              </button>
            </div>
          ))}
        </div>
      )}

      <PlacementCard drives={placements.data?.drives ?? []} />

      {interviews.data?.available && (
        <Link href="/play/interview" className="card spread" style={{ color: "inherit" }}>
          <div>
            <div className="muted small">{t("Mock interview")}</div>
            <b>{t(interviews.data.active ? "Continue your interview" : "Practise a technical interview with AI")}</b>
          </div>
          <Icon name="chat" />
        </Link>
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
                  {t("{done}/{total} steps", { done: path.done, total: path.steps.length })}
                </Link>
              </div>
              <Bar value={(path.done / path.steps.length) * 100} tone="good" />
              {next && (
                <div className="spread">
                  <div className="small">
                    {t("Next:")} <b>{next.title}</b>
                    {next.overdue && <span style={{ color: "var(--bad-ink)" }}> · {t("overdue")}</span>}
                  </div>
                  <button className="btn primary small" disabled={busy} onClick={() => start(next.kind === "skill" ? { kind: "skill", skillId: next.ref } : { kind: "pack", packId: next.ref })}>
                    {t("Continue")}
                  </button>
                </div>
              )}
            </div>
          );
        })}

      {data.assignments.length > 0 && (
        <div className="card stack">
          <h2>{t("Assigned to you")}</h2>
          {data.assignments.map((a) => (
            <div key={a.id} className="spread">
              <div>
                <div style={{ fontWeight: 600 }}>{a.title}</div>
                <div className="muted small">
                  {t("{n} questions · {due}", { n: a.questionCount, due: t("due {when}", { when: timeLeft(a.closeAt, t) }) })}
                </div>
              </div>
              <button className="btn primary small" disabled={busy} onClick={() => start({ kind: "assignment", assignmentId: a.id })}>
                {t(a.status === "in_progress" ? "Continue" : "Start")}
              </button>
            </div>
          ))}
        </div>
      )}

      {data.suggestedSkill && (
        <div className="card spread">
          <div>
            <div className="muted small">{t("Suggested next")}</div>
            <div style={{ fontWeight: 700 }}>{data.suggestedSkill.name}</div>
            <div className="muted small">{data.suggestedSkill.topicName}</div>
          </div>
          <button className="btn primary" disabled={busy || p.hearts === 0} onClick={() => start({ kind: "skill", skillId: data.suggestedSkill!.id })}>
            {t("Practise")}
          </button>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <button className="card tight stack" style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }} onClick={() => router.push("/play/league")}>
          <span className="muted small">{t("{division} league", { division: DIVISION_LABELS[data.league.division] })}</span>
          <span className="kpi">{data.league.rank ? `#${data.league.rank}` : "-"}</span>
          <span className="muted small">{data.league.rank ? t("of {size} · {xp} XP this week", { size: data.league.groupSize, xp: data.league.weeklyXp }) : t("Earn XP to join this week")}</span>
        </button>
        <button
          className="card tight stack"
          style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}
          onClick={() => (data.openMistakes ? start({ kind: "mistakes" }) : router.push("/play/mistakes"))}
        >
          <span className="muted small">{t("Mistakes to review")}</span>
          <span className="kpi">{data.openMistakes}</span>
          <span className="muted small">{t(data.openMistakes ? "Fix one to earn a heart" : "All clear")}</span>
        </button>
      </div>
    </div>
  );
}
