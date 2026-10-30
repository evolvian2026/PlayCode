"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { countWords, WRITING_DIMENSIONS, WRITING_KINDS, wordLimitStatus, type WritingKind, type WritingTask } from "@playcode/core";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

interface Feedback {
  scores: Record<string, number>;
  overall: number;
  pointsCovered: number[];
  strengths: string[];
  improvements: string[];
  corrections: { original: string; better: string; why: string }[];
  improved: string;
}

interface Attempt {
  id: string;
  task: WritingTask;
  text: string;
  words: number;
  timeMs: number;
  feedback: Feedback;
  createdAt: string;
}

interface Home {
  available: boolean;
  reason: string | null;
  leftToday: number;
  tasks: (WritingTask & { best: number | null })[];
  attempts: { id: string; taskId: string; title: string; kind: WritingKind; overall: number; words: number; createdAt: string }[];
}

const draftKey = (taskId: string) => `playcode.writing.${taskId}`;
const readDraft = (taskId: string) => {
  try {
    return localStorage.getItem(draftKey(taskId)) ?? "";
  } catch {
    return "";
  }
};
const writeDraft = (taskId: string, text: string) => {
  try {
    if (text) localStorage.setItem(draftKey(taskId), text);
    else localStorage.removeItem(draftKey(taskId));
  } catch {
    // Storage blocked: the draft just isn't kept.
  }
};
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Result({ attempt, onAgain, onBack }: { attempt: Attempt; onAgain: () => void; onBack: () => void }) {
  const t = useT();
  const f = attempt.feedback;
  const task = attempt.task;
  return (
    <div className="stack">
      <div>
        <div className="small muted">{t(WRITING_KINDS[task.kind])}</div>
        <h1 style={{ margin: 0 }}>{task.title}</h1>
        <div className="small muted">{t("{words} words in {time}", { words: attempt.words, time: clock(attempt.timeMs) })}</div>
      </div>
      <div className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>{t("Your feedback")}</h2>
          <span className={`pill ${f.overall >= 4 ? "good" : f.overall === 3 ? "warn" : "bad"}`}>{t("Overall {n}/5", { n: f.overall })}</span>
        </div>
        {WRITING_DIMENSIONS.map(([key, label]) => {
          const n = f.scores[key] ?? 0;
          return (
            <div key={key}>
              <div className="spread small">
                <span>{t(label)}</span>
                <b>{n}/5</b>
              </div>
              <Bar value={n * 20} tone={n >= 4 ? "good" : n === 3 ? "warn" : "bad"} label={t(label)} />
            </div>
          );
        })}
        {task.points.length > 0 && (
          <div>
            <b className="small">{t("Points to cover")}</b>
            <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 0, listStyle: "none" }}>
              {task.points.map((p, i) => {
                const covered = f.pointsCovered.includes(i);
                return (
                  <li key={p} style={{ color: covered ? "var(--good-ink)" : "var(--bad-ink)" }}>
                    <span aria-hidden="true">{covered ? "✓" : "✗"}</span> {p}
                    <span className="sr-only"> {t(covered ? "(covered)" : "(missing)")}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {(
          [
            ["What went well", f.strengths],
            ["To work on", f.improvements],
          ] as const
        ).map(([title, items]) =>
          items.length ? (
            <div key={title}>
              <b className="small">{t(title)}</b>
              <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {items.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
        {f.corrections.length > 0 && (
          <div>
            <b className="small">{t("Corrections")}</b>
            <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {f.corrections.map((c) => (
                <li key={c.original}>
                  <s>{c.original}</s> → <b>{c.better}</b>
                  <div className="muted">{c.why}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <details>
          <summary className="small" style={{ fontWeight: 600 }}>
            {t("A corrected version")}
          </summary>
          <div className="card tight small" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
            {f.improved}
          </div>
        </details>
        <details>
          <summary className="small" style={{ fontWeight: 600 }}>
            {t("What you wrote")}
          </summary>
          <div className="card tight small" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
            {attempt.text}
          </div>
        </details>
      </div>
      <div className="row wrap">
        <button className="btn primary" onClick={onAgain}>
          {t("Write this one again")}
        </button>
        <button className="btn" onClick={onBack}>
          {t("Choose another task")}
        </button>
      </div>
    </div>
  );
}

function Editor({ task, leftToday, onMarked, onBack }: { task: WritingTask; leftToday: number; onMarked: (a: Attempt) => void; onBack: () => void }) {
  const t = useT();
  const [text, setText] = useState(() => readDraft(task.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => writeDraft(task.id, text), [task.id, text]);

  const left = task.minutes * 60_000 - (now - started.current);
  const words = countWords(text);
  const status = wordLimitStatus(words, task);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const attempt = await api<Attempt>("/student/writing", { body: { taskId: task.id, text, timeMs: Math.min(3 * 3_600_000, Date.now() - started.current) } });
      writeDraft(task.id, "");
      onMarked(attempt);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="spread">
        <div>
          <div className="small muted">{t(WRITING_KINDS[task.kind])}</div>
          <h1 style={{ margin: 0 }}>{task.title}</h1>
        </div>
        <span className={`pill ${left <= 0 ? "bad" : left < 120_000 ? "warn" : ""}`} role="timer" aria-label={t("Time left")}>
          {left > 0 ? clock(left) : t("Time's up")}
        </span>
      </div>
      <div className="card stack">
        <p style={{ margin: 0 }}>{task.prompt}</p>
        {task.points.length > 0 && (
          <div>
            <b className="small">{t("Include:")}</b>
            <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {task.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="small muted">{t("{min} to {max} words, {minutes} minutes", { min: task.minWords, max: task.maxWords, minutes: task.minutes })}</div>
      </div>
      <textarea
        className="prose"
        aria-label={t("Your answer")}
        aria-describedby="word-count"
        rows={task.kind === "email" ? 12 : 16}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={6000}
        spellCheck={false}
        placeholder={task.kind === "email" ? "Subject: ...\n\nDear ...," : t("Write your essay here.")}
        disabled={busy}
      />
      {left <= 0 && <div className="small" style={{ color: "var(--warn-ink)" }}>{t("Time's up. In the test, your answer would be sent now; finish your sentence and send it.")}</div>}
      {error && <ErrorBox message={error} />}
      <div className="stack" style={{ gap: 8 }}>
        <span id="word-count" className="small" style={{ color: status === "ok" ? "var(--good-ink)" : "var(--muted)" }} aria-live="polite">
          {t("{n} words", { n: words })} · {t(status === "short" ? "below the limit" : status === "long" ? "over the limit" : "within the limit")}
        </span>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" disabled={busy} onClick={onBack}>
            {t("Back")}
          </button>
          <button className="btn primary" disabled={busy || words < 20 || leftToday === 0}>
            {busy ? t("Marking...") : t("Get feedback")}
          </button>
        </div>
      </div>
      <div className="small muted">{t("Spell-check is off, as in the test. Your draft is kept on this device until you send it.")}</div>
    </form>
  );
}

function WritingHome() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const taskId = params.get("task");
  const attemptId = params.get("id");
  const home = useApi<Home>("/student/writing");
  const opened = useApi<Attempt>(attemptId ? `/student/writing/${attemptId}` : null);
  const [kind, setKind] = useState<WritingKind>("email");

  const back = () => {
    router.push("/play/writing");
    void home.reload();
  };
  if (attemptId) {
    if (opened.loading && !opened.data) return <Loading />;
    if (opened.error || !opened.data) return <ErrorBox message={opened.error?.message ?? t("Could not load")} onRetry={opened.reload} />;
    return <Result attempt={opened.data} onAgain={() => router.push(`/play/writing?task=${opened.data!.task.id}`)} onBack={back} />;
  }
  if (home.loading && !home.data) return <Loading />;
  if (home.error || !home.data) return <ErrorBox message={home.error?.message ?? t("Could not load")} onRetry={home.reload} />;
  const d = home.data;
  const task = taskId ? d.tasks.find((x) => x.id === taskId) : undefined;
  if (task && d.available) return <Editor key={task.id} task={task} leftToday={d.leftToday} onMarked={(a) => router.replace(`/play/writing?id=${a.id}`)} onBack={back} />;

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Written English")}</h1>
      <div className="card stack">
        <p style={{ margin: 0 }}>
          {t("Practise the email and essay tasks from the written section of placement tests. Write against the clock, then get marks on the test's rubric, the corrections that matter most, and a corrected version.")}
        </p>
        {!d.available ? (
          <div className="small muted">{d.reason}</div>
        ) : (
          <div className="small muted">{d.leftToday ? t("{n} answers can be marked today", { n: d.leftToday }) : t("You've had today's answers marked. Come back tomorrow.")}</div>
        )}
      </div>
      {d.available && (
        <>
          <div className="row" role="group" aria-label={t("Kind of task")}>
            {(Object.keys(WRITING_KINDS) as WritingKind[]).map((k) => (
              <button key={k} className={`btn small ${kind === k ? "primary" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {t(WRITING_KINDS[k])}
              </button>
            ))}
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {d.tasks
              .filter((x) => x.kind === kind)
              .map((x) => (
                <button key={x.id} className="card spread" style={{ textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }} onClick={() => router.push(`/play/writing?task=${x.id}`)}>
                  <div>
                    <b>{x.title}</b>
                    <div className="small muted">{t("{min} to {max} words, {minutes} minutes", { min: x.minWords, max: x.maxWords, minutes: x.minutes })}</div>
                  </div>
                  {x.best ? <span className="pill">{t("Best {n}/5", { n: x.best })}</span> : <span aria-hidden="true">→</span>}
                </button>
              ))}
          </div>
        </>
      )}
      {d.attempts.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t("Your answers")}</h2>
          {d.attempts.map((a) => (
            <button key={a.id} className="spread" style={{ all: "unset", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8 }} onClick={() => router.push(`/play/writing?id=${a.id}`)}>
              <span>
                {a.title} <span className="small muted">· {new Date(a.createdAt).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short" })}</span>
              </span>
              <span className="pill">{a.overall}/5</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WritingPage() {
  return (
    <Suspense fallback={<Loading />}>
      <WritingHome />
    </Suspense>
  );
}
