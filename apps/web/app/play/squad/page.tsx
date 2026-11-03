"use client";

import { useState, type FormEvent } from "react";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Squad {
  id: string;
  name: string;
  code: string;
  weeklyGoal: number;
  canEditGoal: boolean;
  week: { answers: number; goal: number; reached: boolean; daysLeft: number };
  streakWeeks: number;
  members: { id: string; name: string; me: boolean; answersThisWeek: number; streak: number; practisedToday: boolean }[];
  maxMembers: number;
}

interface SquadResponse {
  squad: Squad | null;
  goals: number[];
}

function Start({ goals, onDone }: { goals: number[]; onDone: (r: SquadResponse) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(100);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "create" | "join", e: FormEvent) {
    e.preventDefault();
    setBusy(kind);
    setError(null);
    try {
      onDone(kind === "create" ? await api<SquadResponse>("/student/squad", { body: { name, weeklyGoal: goal } }) : await api<SquadResponse>("/student/squad/join", { body: { code } }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        {t("Practise with up to five classmates. Your squad shares a weekly goal of answers, keeps a streak of weeks it hits the goal, and can nudge anyone who hasn't practised today. Squadmates see how much you practise, not your scores.")}
      </p>
      <form className="card stack" onSubmit={(e) => run("join", e)}>
        <h2 style={{ margin: 0 }}>{t("Join a squad")}</h2>
        <div>
          <label htmlFor="squad-code">{t("Squad code from a classmate")}</label>
          <input id="squad-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} autoComplete="off" required style={{ textTransform: "uppercase", letterSpacing: 2 }} />
        </div>
        <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy !== null || code.trim().length < 4}>
          {busy === "join" ? t("Joining...") : t("Join")}
        </button>
      </form>
      <form className="card stack" onSubmit={(e) => run("create", e)}>
        <h2 style={{ margin: 0 }}>{t("Start a squad")}</h2>
        <div>
          <label htmlFor="squad-name">{t("Name")}</label>
          <input id="squad-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder={t("e.g. Byte Club")} />
        </div>
        <div>
          <label htmlFor="squad-goal">{t("Weekly goal (answers, for the whole squad)")}</label>
          <select id="squad-goal" value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
            {goals.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <div className="small muted" style={{ marginTop: 4 }}>
            {t("About 20 to 30 a person each week is a good start.")}
          </div>
        </div>
        <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy !== null || name.trim().length < 2}>
          {busy === "create" ? t("Starting...") : t("Start the squad")}
        </button>
      </form>
      {error && <ErrorBox message={error} />}
    </>
  );
}

function SquadView({ squad, goals, onChange }: { squad: Squad; goals: number[]; onChange: (r: SquadResponse) => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [nudged, setNudged] = useState<string[]>([]);
  const pct = Math.min(100, Math.round((squad.week.answers / squad.week.goal) * 100));

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <div className="card stack">
        <div className="spread wrap">
          <h2 style={{ margin: 0 }}>{squad.name}</h2>
          <span className="pill accent">{t("{n}-week streak", { n: squad.streakWeeks })}</span>
        </div>
        <div>
          <div className="spread small">
            <b>{t("{n} of {goal} answers this week", { n: squad.week.answers, goal: squad.week.goal })}</b>
            <span className="muted">{squad.week.reached ? t("Goal reached") : t("{n} days left", { n: squad.week.daysLeft })}</span>
          </div>
          <Bar value={pct} tone={squad.week.reached ? "good" : pct >= 60 ? undefined : "warn"} label={t("Weekly goal")} />
        </div>
        <div className="small">
          {t("Invite classmates with the code")} <code className="inline-code" style={{ letterSpacing: 2 }}>{squad.code}</code>{" "}
          <span className="muted">({t("{n} of {max} places taken", { n: squad.members.length, max: squad.maxMembers })})</span>
        </div>
      </div>

      <section className="card stack" aria-labelledby="squad-members">
        <h2 id="squad-members" style={{ margin: 0 }}>
          {t("This week")}
        </h2>
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {squad.members.map((m) => (
            <li key={m.id} className="spread wrap">
              <div>
                <b>
                  {m.name}
                  {m.me ? ` (${t("you")})` : ""}
                </b>
                <div className="small muted">
                  {t("{n} answers", { n: m.answersThisWeek })} · {t("{n}-day streak", { n: m.streak })}
                  {m.practisedToday ? ` · ${t("practised today")}` : ""}
                </div>
              </div>
              {!m.me && !m.practisedToday && (
                <button
                  className="btn small"
                  disabled={nudged.includes(m.id)}
                  onClick={() =>
                    run(async () => {
                      await api("/student/squad/nudge", { body: { userId: m.id } });
                      setNudged([...nudged, m.id]);
                    })
                  }
                >
                  {nudged.includes(m.id) ? t("Nudged") : t("Nudge")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {error && <ErrorBox message={error} />}
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        {squad.canEditGoal && (
          <div>
            <label htmlFor="squad-goal-edit">{t("Weekly goal")}</label>
            <select
              id="squad-goal-edit"
              value={squad.weeklyGoal}
              onChange={(e) => run(async () => onChange(await api<SquadResponse>("/student/squad", { method: "PUT", body: { weeklyGoal: Number(e.target.value) } })))}
            >
              {goals.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          className="btn ghost"
          onClick={() => window.confirm(t("Leave {name}?", { name: squad.name })) && run(async () => onChange(await api<SquadResponse>("/student/squad/leave", { body: {} })))}
        >
          {t("Leave squad")}
        </button>
      </div>
    </>
  );
}

export default function SquadPage() {
  const t = useT();
  const { data, error, loading, reload, setData } = useApi<SquadResponse>("/student/squad");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Study squad")}</h1>
      {data.squad ? <SquadView squad={data.squad} goals={data.goals} onChange={setData} /> : <Start goals={data.goals} onDone={setData} />}
    </div>
  );
}
