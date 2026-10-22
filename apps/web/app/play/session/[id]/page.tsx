"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EvaluationView } from "@/components/CodeAnswer";
import { draftToResponse, emptyDraft, QuestionInput, type Draft } from "@/components/QuestionInput";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { usePlayer } from "@/lib/player-state";
import type { AnswerResult, Evaluation, SessionView } from "@/lib/types";

// Code drafts survive a reload or an accidental exit.
const draftKey = (sessionId: string, questionId: string) => `playcode.draft.${sessionId}.${questionId}`;
function loadDraft(sessionId: string, questionId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(sessionId, questionId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function saveDraft(sessionId: string, questionId: string, d: Draft | null) {
  try {
    if (d) localStorage.setItem(draftKey(sessionId, questionId), JSON.stringify(d));
    else localStorage.removeItem(draftKey(sessionId, questionId));
  } catch {
    // Storage blocked: the draft lives only in memory.
  }
}

const DIFFICULTY = ["", "Easy", "Medium", "Hard"];

function Summary({ session, onHome, certificate }: { session: SessionView; onHome: () => void; certificate: string | null }) {
  const pct = session.total ? Math.round((session.correctCount / session.total) * 100) : 0;
  const passed = session.passed;
  return (
    <div className="stack center" style={{ paddingTop: 32 }}>
      <div className="hero-emoji" aria-hidden="true">
        <Icon name={passed === false ? "refresh" : "trophy"} size={64} className={passed === false ? "" : "stat-xp"} />
      </div>
      <h1>{passed === true ? "Mission cleared!" : passed === false ? "Not this time" : "Set complete"}</h1>
      <p className="muted">{session.title}</p>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <div className="kpi">
            {session.correctCount}/{session.total}
          </div>
          <div className="muted small">correct ({pct}%)</div>
        </div>
        <div className="card">
          <div className="kpi stat-xp">+{session.xpEarned}</div>
          <div className="muted small">XP earned</div>
        </div>
      </div>
      {session.passMark !== null && (
        <p className="muted">
          Pass mark {session.passMark}%. {passed ? "You can retry any time to improve your best score." : "Review your mistakes, then try again."}
        </p>
      )}
      {session.answered < session.total && <p className="muted">You ran out of hearts. Review a mistake to earn one back.</p>}
      {certificate && (
        <Link href={`/verify/${certificate}`} className="btn big" style={{ borderColor: "var(--accent)" }}>
          <Icon name="award" /> View your certificate
        </Link>
      )}
      <button className="btn primary big" onClick={onHome}>
        Continue
      </button>
    </div>
  );
}

export default function SessionPlayer() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setProfile, profile } = usePlayer();
  const { data: loaded, error, loading, reload } = useApi<SessionView>(`/student/sessions/${id}`);
  const [session, setSession] = useState<SessionView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<Evaluation | null>(null);
  const [certificate, setCertificate] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    if (loaded && !session) setSession(loaded);
  }, [loaded, session]);

  const question = session?.question ?? null;
  useEffect(() => {
    if (question) {
      const saved = question.responseKind === "code" || question.responseKind === "sql" ? loadDraft(id, question.id) : null;
      setDraft(saved?.kind === question.responseKind ? saved : emptyDraft(question));
      setRunResult(null);
      setHints([]);
      shownAt.current = Date.now();
    }
    // Reset only when the question changes, not on every session update.
  }, [question?.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  if (loading && !session) return <Loading />;
  if (error && !session) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!session) return null;

  const exit = () => router.push("/play");
  if (session.finished && !result) return <Summary session={session} onHome={exit} certificate={certificate} />;
  if (!question || !draft) return <Loading />;

  const response = draftToResponse(draft);
  const executes = draft.kind === "code" || draft.kind === "sql";

  function updateDraft(d: Draft) {
    setDraft(d);
    if (d.kind === "code" || d.kind === "sql") saveDraft(id, question!.id, d);
  }

  async function run() {
    if (!response || !question) return;
    setRunning(true);
    setActionError(null);
    try {
      setRunResult(await api<Evaluation>(`/student/sessions/${session!.id}/run`, { body: { questionId: question.id, response } }));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  async function submit() {
    if (!response || result || busy || !question) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await api<AnswerResult>(`/student/sessions/${session!.id}/answer`, {
        body: { questionId: question.id, response, timeMs: Date.now() - shownAt.current },
      });
      setResult(r);
      setProfile(r.profile);
      if (r.certificate) setCertificate(r.certificate);
      saveDraft(id, question.id, null);
      if (r.levelUp) setToast(`Level up! You are now level ${r.profile.level}`);
      else if (r.streakExtended && r.profile.streak.days > 1) setToast(`${r.profile.streak.days}-day streak!`);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function hint() {
    if (!question) return;
    try {
      const h = await api<{ hint: string }>(`/student/sessions/${session!.id}/hint`, { body: { questionId: question.id } });
      setHints((prev) => [...prev, h.hint]);
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  function next() {
    if (!result) return;
    setSession(result.session);
    setResult(null);
  }

  const progress = ((session.answered + (result ? 1 : 0)) / session.total) * 100;
  const hintsLeft = question.hintCount - question.hintsUsed - hints.length;

  return (
    <div className="stack" style={{ paddingBottom: 24 }}>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <div className="row">
        <button className="btn ghost small" onClick={exit} aria-label="Leave session">
          <Icon name="x" />
        </button>
        <div style={{ flex: 1 }}>
          <Bar value={progress} tone="good" />
        </div>
        {session.usesHearts && (
          <span className="stat-heart row" style={{ gap: 4, fontWeight: 700 }} aria-label={`${profile?.hearts ?? 0} hearts`}>
            <Icon name="heart" size={18} /> {profile?.hearts ?? ""}
          </span>
        )}
      </div>

      <div className="row wrap" style={{ gap: 6 }}>
        <span className="pill accent">{question.typeLabel}</span>
        <span className="pill">{question.body.language === "pseudocode" ? "Pseudocode" : question.body.language.toUpperCase()}</span>
        <span className="pill">{DIFFICULTY[question.difficulty]}</span>
        <span className="muted small" style={{ marginLeft: "auto" }}>
          {session.answered + 1} / {session.total}
        </span>
      </div>

      <h2 style={{ fontSize: "1.15rem", whiteSpace: "pre-line" }}>
        {/* `backticks` in a stem mark inline code. */}
        {question.body.stem.split("`").map((part, i) => (i % 2 ? <code key={i} className="inline-code">{part}</code> : part))}
      </h2>

      <QuestionInput question={question} draft={draft} onChange={updateDraft} onSubmit={submit} answer={result?.answer ?? null} />

      {runResult && !result && <EvaluationView evaluation={runResult} title={runResult.kind === "code" ? "Sample tests" : "Your query's result"} />}

      {hints.map((h, i) => (
        <div key={i} className="card tight row" style={{ background: "var(--warn-soft)", borderColor: "transparent" }}>
          <Icon name="bulb" className="stat-xp" />
          <span>{h}</span>
        </div>
      ))}

      {actionError && <ErrorBox message={actionError} />}

      {result ? (
        <div className={`feedback stack ${result.correct ? "right" : "wrong"}`} role="status" aria-live="polite">
          <div className="spread">
            <h2 style={{ margin: 0, color: result.correct ? "var(--good)" : "var(--bad)" }}>
              <Icon name={result.correct ? "check" : "x"} /> {result.correct ? "Correct!" : "Not quite"}
            </h2>
            {result.xp > 0 && <span className="pill" style={{ color: "var(--xp)" }}>+{result.xp} XP</span>}
          </div>
          {result.evaluation && <EvaluationView evaluation={result.evaluation} title={result.evaluation.kind === "code" ? "All tests" : "Your query's result"} />}
          {!result.correct && (
            <div>
              <div className="small muted">{executes ? "Model solution" : "Correct answer"}</div>
              <pre>{result.correctAnswer}</pre>
            </div>
          )}
          <p style={{ margin: 0 }}>{result.explanation}</p>
          {result.xpBreakdown.length > 1 && (
            <div className="row wrap small muted" style={{ gap: 8 }}>
              {result.xpBreakdown.map((b) => (
                <span key={b.label}>
                  {b.label} {b.value > 0 ? `+${b.value}` : b.value || ""}
                </span>
              ))}
            </div>
          )}
          <button className="btn primary big" onClick={next} autoFocus>
            {result.session.finished ? "See results" : "Continue"}
          </button>
        </div>
      ) : (
        <div className="stack">
          {executes && (
            <button className="btn big" disabled={!response || running || busy} onClick={run}>
              {running ? "Running..." : draft.kind === "code" ? "Run sample tests" : "Run query"}
            </button>
          )}
          <button className="btn primary big" disabled={!response || busy || running} onClick={submit}>
            {busy ? (executes ? "Running all tests..." : "Checking...") : executes ? "Submit" : "Check"}
          </button>
          {hintsLeft > 0 && (
            <button className="btn ghost small" onClick={hint}>
              <Icon name="bulb" size={16} /> Use a hint (costs some XP)
            </button>
          )}
        </div>
      )}
      <Link href="/play" className="small muted center">
        Save and exit
      </Link>
    </div>
  );
}
