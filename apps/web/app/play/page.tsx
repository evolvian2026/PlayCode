"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DIVISION_LABELS, type Division } from "@playcode/core";
import { useMe } from "@/components/Auth";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { EventItem } from "@/components/Events";
import { startAndOpen, type StartInput } from "@/lib/start";
import { startFor, type StudyPlan } from "@/lib/plan";
import type { ProfileSummary, StudentPath } from "@/lib/types";
import { useLocale, useT, type Translate } from "@/lib/i18n";
import { unsyncedAnswers } from "@/lib/offline";

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
  review: { dueCount: number; skills: { id: string; name: string; overdueDays: number }[]; questionCount: number; sessionId: string | null };
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

/** Today's task from the student's study plan. */
function PlanCard() {
  const t = useT();
  const router = useRouter();
  const { data } = useApi<{ plan: StudyPlan | null }>("/student/plan");
  const [error, setError] = useState<string | null>(null);
  const plan = data?.plan;
  if (!plan?.today) return null;
  const today = plan.today;
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="spread">
        <div>
          <div className="muted small">
            {t("Study plan")} · {plan.target.label} · {t("{n} days to go", { n: plan.daysLeft })}
          </div>
          <b>{t(today.title)}</b>
        </div>
        {today.status === "done" ? (
          <span className="pill good">{t("Done")}</span>
        ) : (
          <button className="btn primary small" onClick={async () => setError(await startAndOpen(startFor(today), router.push))}>
            {t("Start")}
          </button>
        )}
      </div>
      {error && <ErrorBox message={error} />}
      <Link href="/play/plan" className="small">
        {t("{done} of {due} days done so far", { done: plan.doneSoFar, due: plan.dueSoFar })}
      </Link>
    </div>
  );
}

/** The student's squad and its progress this week. */
function SquadCard() {
  const t = useT();
  const { data } = useApi<{ squad: { name: string; streakWeeks: number; week: { answers: number; goal: number; reached: boolean } } | null }>("/student/squad");
  const squad = data?.squad;
  if (!squad) return null;
  return (
    <Link href="/play/squad" className="card stack" style={{ color: "inherit", gap: 6 }}>
      <div className="spread small">
        <b>{squad.name}</b>
        <span className="muted">
          {t("{n} of {goal} answers this week", { n: squad.week.answers, goal: squad.week.goal })}
        </span>
      </div>
      <Bar value={Math.min(100, Math.round((squad.week.answers / squad.week.goal) * 100))} tone={squad.week.reached ? "good" : undefined} label={t("Weekly goal")} />
    </Link>
  );
}

/** A training session taking attendance now, or the next one within a day. */
function TrainingCard() {
  const t = useT();
  const locale = useLocale();
  const { data } = useApi<{ openNow: { id: string; title: string; location: string }[]; upcoming: { id: string; title: string; location: string; startsAt: string; status: string }[] }>("/student/training");
  const open = data?.openNow[0];
  const next = data?.upcoming.find((s) => s.status === "scheduled" && new Date(s.startsAt).getTime() - Date.now() < 86_400_000);
  if (!open && !next) return null;
  return (
    <Link href="/play/training" className="card spread" style={{ color: "inherit", borderColor: open ? "var(--accent)" : undefined }}>
      <div>
        <b>{open ? t("Check in to {title}", { title: open.title }) : t("Training: {title}", { title: next!.title })}</b>
        <div className="small muted">
          {open
            ? t("Type the code shown in {place}.", { place: open.location })
            : `${new Date(next!.startsAt).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" })} · ${next!.location}`}
        </div>
      </div>
      <Icon name="arrow" />
    </Link>
  );
}

/** Answers given offline that haven't been checked yet. */
function OfflineCard() {
  const t = useT();
  const [waiting, setWaiting] = useState(0);
  useEffect(() => setWaiting(unsyncedAnswers()), []);
  if (!waiting) return null;
  return (
    <Link href="/offline" className="card spread" style={{ color: "inherit", borderColor: "var(--accent)" }}>
      <div>
        <b>{t("{n} offline answers to check", { n: waiting })}</b>
        <div className="small muted">{t("You're online: check them to get your XP and streak.")}</div>
      </div>
      <Icon name="arrow" />
    </Link>
  );
}

/** A contest that is running, or starts within a week. */
function ContestCard() {
  const t = useT();
  const { data } = useApi<{ contests: { id: string; title: string; state: string; startsAt: string }[] }>("/student/contests");
  const soon = (data?.contests ?? []).filter((c) => c.state === "live" || c.state === "frozen" || (c.state === "upcoming" && new Date(c.startsAt).getTime() - Date.now() < 7 * 86_400_000));
  const c = soon.find((x) => x.state !== "upcoming") ?? soon[soon.length - 1];
  if (!c) return null;
  return (
    <Link href={`/play/contests/${c.id}`} className="card spread" style={{ color: "inherit" }}>
      <div>
        <div className="muted small">{t("Coding contest")}</div>
        <b>{c.title}</b>
        <div className="small muted">{c.state === "upcoming" ? t("Starts {when}", { when: new Date(c.startsAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) }) : t("Live now")}</div>
      </div>
      <Icon name="trophy" />
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

      <TrainingCard />
      <PlanCard />

      <Link href="/play/live" className="card tight spread" style={{ color: "inherit" }}>
        <span>
          <b>{t("Join a live quiz")}</b> <span className="small muted">{t("with the code on your teacher's screen")}</span>
        </span>
        <Icon name="bolt" />
      </Link>

      <OfflineCard />
      <SquadCard />
      <ContestCard />

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

      {data.review.dueCount > 0 && (
        <div className="card spread">
          <div>
            <div className="muted small">{t("Keep it fresh")}</div>
            <div style={{ fontWeight: 700 }}>{t(data.review.dueCount === 1 ? "1 skill is fading" : "{n} skills are fading", { n: data.review.dueCount })}</div>
            <div className="muted small">
              {data.review.skills.map((s) => s.name).join(", ")} · {t("{n} questions, no hearts", { n: data.review.questionCount })}
            </div>
          </div>
          <button className="btn primary" disabled={busy} onClick={() => start({ kind: "review" })}>
            {t(data.review.sessionId ? "Continue" : "Review")}
          </button>
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
