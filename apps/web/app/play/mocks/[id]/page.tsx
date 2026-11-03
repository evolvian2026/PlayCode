"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StudentResponse } from "@playcode/core";
import { CodeBlock } from "@/components/CodeBlock";
import { EvaluationView } from "@/components/CodeAnswer";
import { Icon } from "@/components/Icon";
import { draftToResponse, emptyDraft, QuestionInput, responseToDraft, type Draft } from "@/components/QuestionInput";
import { Bar, ErrorBox, Loading, masteryTone } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { startAndOpen } from "@/lib/start";
import { useT } from "@/lib/i18n";
import type { Evaluation, QuestionView } from "@/lib/types";

interface Section {
  title: string;
  minutes: number;
  kind: "quick" | "coding";
  marks: number;
  count: number;
  answered: number;
  state: "closed" | "open" | "upcoming";
}

interface Report {
  score: number;
  maxScore: number;
  pct: number;
  percentile: number | null;
  compared: number;
  sections: { title: string; score: number; max: number; correct: number; wrong: number; skipped: number; pct: number; target: number }[];
  focus: { section: number; title: string; pct: number; target: number; skillId: string | null; skillName: string | null }[];
  review: { section: number; questionId: string; stem: string; code: string | null; yourAnswer: string | null; correctAnswer: string; explanation: string; correct: boolean; score: number; detail: { passed?: number; total?: number } | null }[];
}

interface MockView {
  id: string;
  pattern: { id: string; name: string; minutes: number };
  status: "in_progress" | "submitted";
  section: number | null;
  timeLeftMs: number;
  sections: Section[];
  questions: { question: QuestionView; saved: StudentResponse | null }[];
  result: Report | null;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function ReportView({ view }: { view: MockView }) {
  const t = useT();
  const router = useRouter();
  const [practiseError, setPractiseError] = useState<string | null>(null);
  const r = view.result!;
  return (
    <div className="stack">
      <div>
        <Link href="/play/mocks" className="small muted">
          {t("Mock tests")}
        </Link>
        <h1 style={{ margin: 0 }}>{t(view.pattern.name)}</h1>
      </div>
      <div className="card spread wrap" role="status">
        <div>
          <div className="kpi">{r.pct}%</div>
          <div className="small muted">{t("{score} of {max} marks", { score: r.score, max: r.maxScore })}</div>
        </div>
        <div className="small" style={{ maxWidth: 360 }}>
          {r.percentile !== null
            ? t("You scored higher than {p}% of the {n} students who have taken this pattern (their latest attempt).", { p: r.percentile, n: r.compared })
            : t("Your percentile appears once 20 students have taken this pattern.")}
        </div>
      </div>

      <section className="card stack" aria-labelledby="mock-sections">
        <h2 id="mock-sections" style={{ margin: 0 }}>
          {t("Sections")}
        </h2>
        {r.sections.map((s) => (
          <div key={s.title} className="stack" style={{ gap: 4 }}>
            <div className="spread small">
              <b>{t(s.title)}</b>
              <span>
                {s.score} / {s.max} · {s.pct}%{s.pct < s.target ? ` · ${t("aim for {n}%", { n: s.target })}` : ""}
              </span>
            </div>
            <Bar value={s.pct} tone={masteryTone(s.pct)} label={t(s.title)} />
            <div className="small muted">{t("{right} right, {wrong} wrong, {skipped} skipped", { right: s.correct, wrong: s.wrong, skipped: s.skipped })}</div>
          </div>
        ))}
      </section>

      {r.focus.length > 0 && (
        <section className="card stack" aria-labelledby="mock-focus">
          <h2 id="mock-focus" style={{ margin: 0 }}>
            {t("Practise next")}
          </h2>
          {practiseError && <ErrorBox message={practiseError} />}
          {r.focus.map((f) => (
            <div key={f.section} className="spread wrap">
              <div className="small">
                <b>{t(f.title)}</b> · {f.pct}% ({t("aim for {n}%", { n: f.target })})
                {f.skillName && <div className="muted">{f.skillName}</div>}
              </div>
              {f.skillId && (
                <button className="btn small" onClick={async () => setPractiseError(await startAndOpen({ kind: "skill", skillId: f.skillId! }, router.push))}>
                  {t("Practise")}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="stack" aria-labelledby="mock-review">
        <h2 id="mock-review" style={{ margin: 0 }}>
          {t("Review your answers")}
        </h2>
        {r.sections.map((s, si) => (
          <details key={s.title} className="card">
            <summary style={{ fontWeight: 600 }}>
              {t(s.title)} ({s.correct}/{r.review.filter((x) => x.section === si).length})
            </summary>
            <ol className="stack" style={{ margin: "12px 0 0", paddingLeft: 20 }}>
              {r.review
                .filter((x) => x.section === si)
                .map((x) => (
                  <li key={x.questionId} className="stack" style={{ gap: 6 }}>
                    <div style={{ whiteSpace: "pre-line", fontWeight: 600 }}>{x.stem}</div>
                    {x.code && <CodeBlock code={x.code} />}
                    <div className="small" style={{ color: x.correct ? "var(--good-ink)" : "var(--bad-ink)" }}>
                      {x.correct ? "✓ " : "✗ "}
                      {x.yourAnswer === null ? t("Not answered") : x.detail?.total ? t("{passed} of {total} tests passed", { passed: x.detail.passed ?? 0, total: x.detail.total }) : t("Your answer")}
                    </div>
                    {x.yourAnswer !== null && !x.detail?.total && <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--mono)" }}>{x.yourAnswer}</pre>}
                    {!x.correct && (
                      <>
                        <div className="small muted">{t("Correct answer")}</div>
                        <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--mono)" }}>
                          {x.correctAnswer}
                        </pre>
                      </>
                    )}
                    <div className="small muted">{x.explanation}</div>
                  </li>
                ))}
            </ol>
          </details>
        ))}
      </section>
      <Link href="/play/mocks" className="btn primary" style={{ alignSelf: "flex-start" }}>
        {t("Back to mock tests")}
      </Link>
    </div>
  );
}

export default function MockTest() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<MockView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [runResult, setRunResult] = useState<Evaluation | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"section" | "test" | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const pending = useRef<Record<string, { timer: ReturnType<typeof setTimeout>; send: () => Promise<void> }>>({});

  const load = useCallback((v: MockView) => {
    setView(v);
    // Trust the server's remaining time, not the device clock.
    setDeadline(Date.now() + v.timeLeftMs);
    setDrafts(Object.fromEntries(v.questions.map((q) => [q.question.id, responseToDraft(q.question, q.saved)])));
    setCurrent(0);
    setRunResult(null);
    setConfirm(null);
  }, []);

  useEffect(() => {
    void api<MockView>(`/student/mocks/${id}`).then(load).catch((e) => setError(errorMessage(e)));
  }, [id, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  /** Send any answers still waiting for their debounce. */
  const flush = useCallback(async () => {
    const waiting = Object.values(pending.current);
    pending.current = {};
    for (const p of waiting) clearTimeout(p.timer);
    await Promise.all(waiting.map((p) => p.send().catch(() => {})));
  }, []);

  const act = useCallback(
    async (path: string, body: unknown) => {
      setBusy(true);
      setError(null);
      try {
        await flush();
        load(await api<MockView>(`/student/mocks/${id}${path}`, body === undefined ? undefined : { body }));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [id, flush, load],
  );

  const inProgress = view?.status === "in_progress";
  const timeLeft = deadline - now;
  // Time up: the server has closed the section; fetch where things stand.
  useEffect(() => {
    if (inProgress && deadline && timeLeft <= 0 && !busy) void act("", undefined);
  }, [inProgress, timeLeft <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !view) return <ErrorBox message={error} />;
  if (!view) return <Loading />;
  if (!inProgress) return <ReportView view={view} />;

  function change(questionId: string, d: Draft) {
    setDrafts((prev) => ({ ...prev, [questionId]: d }));
    setSaveState("saving");
    clearTimeout(pending.current[questionId]?.timer);
    const send = async () => {
      try {
        await api(`/student/mocks/${id}/answers`, { method: "PUT", body: { questionId, response: draftToResponse(d) } });
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        setError(errorMessage(e));
      }
    };
    pending.current[questionId] = {
      send,
      timer: setTimeout(() => {
        delete pending.current[questionId];
        void send();
      }, 700),
    };
  }

  async function run(questionId: string, d: Draft) {
    const response = draftToResponse(d);
    if (!response) return;
    setRunning(true);
    setError(null);
    try {
      setRunResult(await api<Evaluation>(`/student/mocks/${id}/run`, { body: { questionId, response } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  const sectionIndex = view.section!;
  const section = view.sections[sectionIndex]!;
  const last = sectionIndex === view.sections.length - 1;
  const q = view.questions[current];
  const d = q ? (drafts[q.question.id] ?? emptyDraft(q.question)) : null;
  const answered = (qid: string) => Boolean(drafts[qid] && draftToResponse(drafts[qid]!));
  const answeredCount = view.questions.filter((x) => answered(x.question.id)).length;

  return (
    <div className="stack" style={{ paddingBottom: 24 }}>
      <div className="spread" style={{ position: "sticky", top: 0, background: "var(--bg)", padding: "10px 0", zIndex: 5 }}>
        <div>
          <b>{t(section.title)}</b>
          <div className="muted small">
            {t("Section {n} of {total}", { n: sectionIndex + 1, total: view.sections.length })} · {answeredCount}/{view.questions.length} {t("answered")} ·{" "}
            {saveState === "saving" ? t("Saving...") : saveState === "error" ? t("Not saved") : t("All changes saved")}
          </div>
        </div>
        <span className="kpi" style={{ fontSize: "1.3rem", color: timeLeft < 60_000 ? "var(--bad-ink)" : undefined }} role="timer" aria-label={t("Time left in this section")}>
          {clock(timeLeft)}
        </span>
      </div>

      <ol className="row wrap small" aria-label={t("Sections")} style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
        {view.sections.map((s, i) => (
          <li key={s.title} className={`pill ${s.state === "open" ? "accent" : ""}`} aria-current={s.state === "open" ? "step" : undefined}>
            {s.state === "closed" ? "✓ " : ""}
            {i + 1}. {t(s.title)}
          </li>
        ))}
      </ol>

      {view.questions.length > 1 && (
        <nav className="row wrap" aria-label={t("Questions")} style={{ gap: 6 }}>
          {view.questions.map((x, i) => (
            <button
              key={x.question.id}
              className={`btn small ${i === current ? "primary" : ""}`}
              style={{ minWidth: 40, background: i !== current && answered(x.question.id) ? "var(--good-soft)" : undefined }}
              aria-current={i === current ? "step" : undefined}
              aria-label={`${t("Question {n}", { n: i + 1 })}${answered(x.question.id) ? `, ${t("answered")}` : ""}`}
              onClick={() => {
                setCurrent(i);
                setRunResult(null);
              }}
            >
              {i + 1}
            </button>
          ))}
        </nav>
      )}

      {q && d && (
        <section className="stack" aria-label={t("Question {n}", { n: current + 1 })}>
          <h2 style={{ fontSize: "1.1rem", whiteSpace: "pre-line", margin: 0 }}>{q.question.body.stem}</h2>
          <QuestionInput key={q.question.id} question={q.question} draft={d} answer={null} onSubmit={() => {}} onChange={(nd) => change(q.question.id, nd)} />
          {d.kind === "code" && (
            <button className="btn" style={{ alignSelf: "flex-start" }} disabled={running || !draftToResponse(d)} onClick={() => run(q.question.id, d)}>
              {running ? t("Running...") : t("Run sample tests")}
            </button>
          )}
          {runResult && <EvaluationView evaluation={runResult} title={t("Sample tests")} />}
          {view.questions.length > 1 && (
            <div className="spread">
              <button className="btn" disabled={current === 0} onClick={() => setCurrent(current - 1)}>
                <Icon name="back" size={16} /> {t("Previous")}
              </button>
              <button className="btn" disabled={current === view.questions.length - 1} onClick={() => setCurrent(current + 1)}>
                {t("Next")} <Icon name="arrow" size={16} />
              </button>
            </div>
          )}
        </section>
      )}

      {error && <ErrorBox message={error} />}

      {confirm ? (
        <div className="card stack" role="alertdialog" aria-label={confirm === "section" ? t("Finish this section") : t("End the test")}>
          <b>{confirm === "section" ? (last ? t("Finish the test now?") : t("Move to the next section now?")) : t("End the whole test now?")}</b>
          <span className="small">
            {confirm === "section"
              ? t("You have answered {n} of {total} in this section. You can't come back to it.", { n: answeredCount, total: view.questions.length })
              : t("Sections you haven't reached will score zero.")}
          </span>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => (confirm === "section" ? act("/next", { section: sectionIndex }) : act("/finish", {}))}>
              {busy ? t("Saving...") : t("Yes, continue")}
            </button>
            <button className="btn ghost" onClick={() => setConfirm(null)}>
              {t("Keep working")}
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={() => setConfirm("section")}>
            {last ? t("Finish the test") : t("Next section")}
          </button>
          {!last && (
            <button className="btn ghost" disabled={busy} onClick={() => setConfirm("test")}>
              {t("End the test")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
