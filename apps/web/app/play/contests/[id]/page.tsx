"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ordinal, VERDICT_LABELS, type ContestState, type Verdict } from "@playcode/core";
import { EvaluationView } from "@/components/CodeAnswer";
import { draftToResponse, emptyDraft, QuestionInput, type Draft } from "@/components/QuestionInput";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { STATE_LABEL, type BoardRow } from "@/lib/contests";
import { useLocale, useT } from "@/lib/i18n";
import type { Evaluation, QuestionView } from "@/lib/types";

interface ContestView {
  id: string;
  title: string;
  description: string;
  byPlayCode: boolean;
  state: ContestState;
  startsAt: string;
  endsAt: string;
  freezeMinutes: number;
  problems: {
    letter: string;
    id: string;
    question: Omit<QuestionView, "hintsUsed" | "coachUsed"> | null;
    solved: boolean;
    tries: number;
    upsolved: boolean;
    solution: { explanation: string; language: string | null; source: string | null } | null;
  }[];
  result: { rank: number; participants: number; ratingBefore: number; ratingAfter: number; certificateCode: string | null } | null;
  submissions: { id: string; letter: string; verdict: Verdict; passed: number; total: number; at: string; upsolve: boolean }[];
  scoreboard: { frozen: boolean; participants: number; rows: BoardRow[] };
}

function useCountdown(to: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return { done: ms === 0, text: `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` };
}

function Scoreboard({ view }: { view: ContestView }) {
  const t = useT();
  return (
    <section className="card stack" aria-label={t("Scoreboard")}>
      <div className="spread wrap">
        <h2 style={{ margin: 0 }}>{t("Scoreboard")}</h2>
        <span className="small muted">
          {t("{n} taking part", { n: view.scoreboard.participants })}
          {view.scoreboard.frozen ? ` · ${t("frozen: the last minutes show as pending until the end")}` : ""}
        </span>
      </div>
      {view.scoreboard.rows.length === 0 ? (
        <div className="small muted">{t("No submissions yet.")}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{t("Name")}</th>
                <th>{t("Solved")}</th>
                <th>{t("Penalty")}</th>
                {view.problems.map((p) => (
                  <th key={p.id}>{p.letter}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.scoreboard.rows.map((r, i) => (
                <tr key={i} style={r.me ? { background: "var(--accent-soft)", fontWeight: 600 } : undefined}>
                  <td>{r.rank}</td>
                  <td>
                    {r.name}
                    {r.college && <div className="small muted">{r.college}</div>}
                  </td>
                  <td>{r.solved}</td>
                  <td>{r.penalty}</td>
                  {view.problems.map((p) => {
                    const c = r.problems[p.id];
                    return (
                      <td key={p.id} className="small" style={{ color: c?.solvedAtMin != null ? "var(--good-ink)" : c?.tries ? "var(--bad-ink)" : undefined }}>
                        {!c ? "" : c.solvedAtMin != null ? `+${c.tries > 1 ? c.tries - 1 : ""} (${c.solvedAtMin}')` : c.tries ? `-${c.tries}` : ""}
                        {c?.pending ? <span className="muted"> ?{c.pending}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="small muted">{t("Ranked by problems solved, then penalty: minutes to each accepted solution plus 20 per rejected try before it.")}</div>
    </section>
  );
}

export default function ContestPage() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload, setData } = useApi<ContestView>(`/student/contests/${id}`);
  const [tab, setTab] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<"run" | "submit" | null>(null);
  const [runResult, setRunResult] = useState<Evaluation | null>(null);
  const [verdict, setVerdict] = useState<{ verdict: Verdict; passed: number; total: number; upsolve: boolean; compileError: string | null } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const live = data?.state === "live" || data?.state === "frozen";
  const ended = data?.state === "ended";
  const countdown = useCountdown(data ? (data.state === "upcoming" ? data.startsAt : data.endsAt) : new Date().toISOString());

  // Refresh the scoreboard every 20 seconds while the contest runs, and at the start and end.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void reload(), 20_000);
    return () => clearInterval(timer);
  }, [live, reload]);
  useEffect(() => {
    if (countdown.done && data && data.state !== "ended") void reload();
  }, [countdown.done]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const problem = data.problems[tab];
  const question = problem?.question ? ({ ...problem.question, hintsUsed: 0, coachUsed: 0 } as QuestionView) : null;
  const draft = question ? (drafts[question.id] ?? emptyDraft(question)) : null;
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  async function send(kind: "run" | "submit") {
    if (!question || !draft) return;
    const response = draftToResponse(draft);
    if (!response) return setActionError(t("Write your solution first."));
    setBusy(kind);
    setActionError(null);
    setRunResult(null);
    setVerdict(null);
    try {
      if (kind === "run") setRunResult(await api<Evaluation>(`/student/contests/${id}/run`, { body: { questionId: question.id, response } }));
      else {
        setVerdict(await api(`/student/contests/${id}/submit`, { body: { questionId: question.id, response } }));
        setData(await api<ContestView>(`/student/contests/${id}`));
      }
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <Link href="/play/contests" className="small muted">
          {t("Coding contests")}
        </Link>
        <div className="spread wrap" style={{ alignItems: "flex-start" }}>
          <h1 style={{ margin: 0 }}>{data.title}</h1>
          <span className={`pill ${live ? "good" : data.state === "upcoming" ? "accent" : ""}`}>{t(STATE_LABEL[data.state])}</span>
        </div>
        <div className="small muted">
          {fmt(data.startsAt)} - {fmt(data.endsAt)}
          {data.state !== "ended" && (
            <>
              {" "}
              · <span aria-live="off">{data.state === "upcoming" ? t("starts in {time}", { time: countdown.text }) : t("{time} left", { time: countdown.text })}</span>
            </>
          )}
        </div>
        {data.description && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{data.description}</p>}
      </div>

      {data.result && (
        <div className="card spread wrap" role="status" style={{ borderColor: "var(--good-ink)" }}>
          <div>
            <b>{t("You placed {place} of {n}", { place: ordinal(data.result.rank), n: data.result.participants })}</b>
            <div className="small">
              {t("Contest rating {before} → {after}", { before: data.result.ratingBefore, after: data.result.ratingAfter })} ({data.result.ratingAfter >= data.result.ratingBefore ? "+" : ""}
              {data.result.ratingAfter - data.result.ratingBefore})
            </div>
          </div>
          {data.result.certificateCode && (
            <Link className="btn small" href={`/verify/${data.result.certificateCode}`}>
              {t("View certificate")}
            </Link>
          )}
        </div>
      )}

      {data.state === "upcoming" ? (
        <div className="card muted">{t("The {n} problems appear here when the contest starts. Submit as often as you like; each rejected try before a correct one adds 20 minutes of penalty.", { n: data.problems.length })}</div>
      ) : (
        <>
          <div className="row wrap" role="tablist" aria-label={t("Problems")}>
            {data.problems.map((p, i) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={tab === i}
                className={`btn small ${tab === i ? "primary" : ""}`}
                onClick={() => {
                  setTab(i);
                  setRunResult(null);
                  setVerdict(null);
                  setActionError(null);
                }}
              >
                {p.letter}
                {p.solved || p.upsolved ? " ✓" : p.tries ? ` (${p.tries})` : ""}
              </button>
            ))}
          </div>
          {question && draft && (
            <section className="stack" role="tabpanel" aria-label={`${t("Problem")} ${problem!.letter}`}>
              <h2 style={{ fontSize: "1.1rem", whiteSpace: "pre-line", margin: 0 }}>
                {problem!.letter}. {question.body.stem}
              </h2>
              {ended && (
                <div className="small muted">
                  {problem!.solved ? t("You solved this during the contest.") : problem!.upsolved ? t("You solved this in practice after the contest.") : t("The contest is over, but you can keep solving: practice submissions are judged on every test and don't change the scoreboard.")}
                </div>
              )}
              <QuestionInput question={question} draft={draft} onChange={(d) => setDrafts({ ...drafts, [question.id]: d })} onSubmit={() => send("submit")} answer={null} />
              {actionError && <ErrorBox message={actionError} />}
              {verdict && (
                <div className={`card tight ${verdict.verdict === "accepted" ? "good" : ""}`} role="status" style={{ borderColor: verdict.verdict === "accepted" ? "var(--good-ink)" : "var(--bad-ink)" }}>
                  <b>{t(VERDICT_LABELS[verdict.verdict])}</b>
                  {verdict.upsolve ? ` (${t("practice")})` : ""}{" "}
                  {verdict.verdict !== "compile_error" && <span className="small">{t("{passed} of {total} tests passed", { passed: verdict.passed, total: verdict.total })}</span>}
                  {verdict.compileError && <pre className="small" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{verdict.compileError}</pre>}
                </div>
              )}
              {runResult && <EvaluationView evaluation={runResult} title={t(runResult.kind === "code" ? "Sample tests" : "Your query's result")} />}
              {(live || ended) && (
                <div className="row wrap">
                  <button className="btn" disabled={busy !== null} onClick={() => send("run")}>
                    {busy === "run" ? t("Running...") : t("Run samples")}
                  </button>
                  <button className="btn primary" disabled={busy !== null} onClick={() => send("submit")}>
                    {busy === "submit" ? t("Judging...") : ended ? t("Submit for practice") : t("Submit")}
                  </button>
                </div>
              )}
              {problem!.solution && (
                <details className="card">
                  <summary style={{ fontWeight: 600 }}>{t("Model solution")}</summary>
                  <p className="small" style={{ whiteSpace: "pre-wrap" }}>
                    {problem!.solution.explanation}
                  </p>
                  {problem!.solution.source && (
                    <pre className="small" style={{ fontFamily: "var(--mono)", overflowX: "auto", margin: 0 }}>
                      {problem!.solution.source}
                    </pre>
                  )}
                </details>
              )}
            </section>
          )}
          {data.submissions.length > 0 && (
            <details className="card">
              <summary style={{ fontWeight: 600 }}>{t("My submissions ({n})", { n: data.submissions.length })}</summary>
              <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {data.submissions.map((s) => (
                  <li key={s.id}>
                    {s.letter} · {t(VERDICT_LABELS[s.verdict])} · {s.passed}/{s.total} · {s.upsolve ? `${t("practice")} · ` : ""} {new Date(s.at).toLocaleTimeString(locale === "hi" ? "hi-IN" : "en-IN", { hour: "numeric", minute: "2-digit" })}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <Scoreboard view={data} />
    </div>
  );
}
