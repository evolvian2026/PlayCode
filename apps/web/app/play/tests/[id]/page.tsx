"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StudentResponse } from "@playcode/core";
import { EvaluationView } from "@/components/CodeAnswer";
import { draftToResponse, emptyDraft, QuestionInput, type Draft } from "@/components/QuestionInput";
import { Icon } from "@/components/Icon";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import type { Evaluation, QuestionView, TestListItem } from "@/lib/types";

interface AttemptView {
  id: string;
  assessment: { id: string; title: string; instructions: string; proctorLevel: 1 | 2 | 3; durationMinutes: number; sections: { title: string; marks: number; negative: number }[] };
  status: "in_progress" | "submitted" | "auto_submitted";
  deadline: string;
  timeLeftMs: number;
  questions: { section: number; question: QuestionView; saved: StudentResponse | null }[];
  result: { score: number; maxScore: number; sections: { title: string; score: number; max: number; correct: number; wrong: number; skipped: number }[] } | null;
  resultsPending: boolean;
}

/** A stable id for this browser, used to lock strict tests to one device. */
function deviceId(): string {
  try {
    let id = localStorage.getItem("playcode.device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("playcode.device", id);
    }
    return id;
  } catch {
    return "no-storage-device";
  }
}

function responseToDraft(q: QuestionView, r: StudentResponse | null): Draft {
  if (!r) return emptyDraft(q);
  switch (r.kind) {
    case "option":
      return { kind: "option", optionId: r.optionId };
    case "text":
      return { kind: "text", value: r.value };
    case "lines":
      return { kind: "lines", lines: r.lines };
    case "order":
      return { kind: "order", ids: r.ids };
    case "code":
      return { kind: "code", language: r.language, sources: { ...q.body.starterCode, [r.language]: r.source }, starters: q.body.starterCode };
    case "sql":
      return { kind: "sql", query: r.query };
  }
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Report focus loss, tab switches, full-screen exits and copy/paste, in batches. */
function useIntegrity(attemptId: string | null, active: boolean) {
  const queue = useRef<{ type: string; detail?: string }[]>([]);
  useEffect(() => {
    if (!attemptId || !active) return;
    const push = (type: string, detail?: string) => queue.current.push({ type, detail });
    const onVisibility = () => document.hidden && push("tab_hidden");
    const onBlur = () => push("focus_lost");
    const onFullscreen = () => !document.fullscreenElement && push("fullscreen_exit");
    const onPaste = () => push("paste");
    const onCopy = () => push("copy");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("paste", onPaste);
    document.addEventListener("copy", onCopy);
    const flush = setInterval(() => {
      if (!queue.current.length) return;
      const events = queue.current.splice(0, 50);
      void api(`/student/attempts/${attemptId}/events`, { body: { events } }).catch(() => queue.current.unshift(...events));
    }, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("copy", onCopy);
      clearInterval(flush);
    };
  }, [attemptId, active]);
}

/** Strict tests: a webcam snapshot every minute. Returns an error message if the camera is unavailable. */
function useCamera(attemptId: string | null, active: boolean) {
  const [problem, setProblem] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!attemptId || !active) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const snap = () => {
      const v = video.current;
      if (!v || !v.videoWidth) return;
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = Math.round((320 * v.videoHeight) / v.videoWidth);
      canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
      void api(`/student/attempts/${attemptId}/snapshot`, { body: { image: canvas.toDataURL("image/jpeg", 0.6) } }).catch(() => {});
    };
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 320 }, audio: false })
      .then((s) => {
        stream = s;
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.srcObject = s;
        void v.play();
        video.current = v;
        setTimeout(snap, 3000);
        timer = setInterval(snap, 60_000);
      })
      .catch(() => setProblem("Camera access is required for this test. Allow the camera in your browser and reload."));
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [attemptId, active]);
  return problem;
}

function Result({ view }: { view: AttemptView }) {
  return (
    <div className="stack center exam" style={{ paddingTop: 32 }}>
      <Icon name="check" size={56} className="stat-xp" />
      <h1>Test submitted</h1>
      <p className="muted">{view.assessment.title}</p>
      {view.result ? (
        <>
          <div className="kpi">
            {view.result.score} / {view.result.maxScore}
          </div>
          <div className="card" style={{ textAlign: "left" }}>
            <table>
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Score</th>
                  <th>Right</th>
                  <th>Wrong</th>
                  <th>Skipped</th>
                </tr>
              </thead>
              <tbody>
                {view.result.sections.map((s) => (
                  <tr key={s.title}>
                    <td>{s.title}</td>
                    <td>
                      {s.score} / {s.max}
                    </td>
                    <td>{s.correct}</td>
                    <td>{s.wrong}</td>
                    <td>{s.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>Your institution will release the results. You will see your score here.</p>
      )}
      <Link href="/play/tests" className="btn primary big">
        Back to tests
      </Link>
    </div>
  );
}

export default function Exam() {
  const { id } = useParams<{ id: string }>();
  const list = useApi<{ assessments: TestListItem[] }>("/student/assessments");
  const item = list.data?.assessments.find((a) => a.id === id);
  const [view, setView] = useState<AttemptView | null>(null);
  const [current, setCurrent] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [runResult, setRunResult] = useState<Evaluation | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deadlineLocal, setDeadlineLocal] = useState(0);
  const [now, setNow] = useState(Date.now());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback((v: AttemptView) => {
    setView(v);
    // Trust the server's remaining time, not the device clock.
    setDeadlineLocal(Date.now() + v.timeLeftMs);
    setDrafts(Object.fromEntries(v.questions.map((q) => [q.question.id, responseToDraft(q.question, q.saved)])));
  }, []);

  // Resume automatically if the test is already in progress or done.
  useEffect(() => {
    if (item?.attemptId && !view) void api<AttemptView>(`/student/attempts/${item.attemptId}`).then(load).catch((e) => setError(errorMessage(e)));
  }, [item?.attemptId, view, load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const inProgress = view?.status === "in_progress";
  useIntegrity(view?.id ?? null, Boolean(inProgress));
  const cameraProblem = useCamera(view?.id ?? null, Boolean(inProgress && view?.assessment.proctorLevel >= 2));
  const timeLeft = deadlineLocal - now;

  const submit = useCallback(async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      // Flush any pending saves first.
      for (const t of Object.values(timers.current)) clearTimeout(t);
      load(await api<AttemptView>(`/student/attempts/${view.id}/submit`, { body: {} }));
      if (document.fullscreenElement) void document.exitFullscreen();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }, [view, load]);

  // Time up: submit (the server would auto-submit anyway).
  useEffect(() => {
    if (inProgress && deadlineLocal && timeLeft <= 0 && !busy) void submit();
    // Fires on the transition to zero, not every tick.
  }, [inProgress, timeLeft <= 0]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen().catch(() => {});
      load(await api<AttemptView>(`/student/assessments/${id}/start`, { body: { deviceId: deviceId() } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function change(questionId: string, d: Draft) {
    setDrafts((prev) => ({ ...prev, [questionId]: d }));
    setSaveState("saving");
    clearTimeout(timers.current[questionId]);
    timers.current[questionId] = setTimeout(async () => {
      try {
        await api(`/student/attempts/${view!.id}/answers`, { method: "PUT", body: { questionId, response: draftToResponse(d) } });
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        setError(errorMessage(e));
      }
    }, 700);
  }

  async function run(questionId: string, d: Draft) {
    const response = draftToResponse(d);
    if (!response || !view) return;
    setRunning(true);
    try {
      setRunResult(await api<Evaluation>(`/student/attempts/${view.id}/run`, { body: { questionId, response } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  if (list.loading && !list.data) return <Loading />;
  if (!item) return <ErrorBox message={list.error?.message ?? "Test not found"} />;
  if (view && !inProgress) return <Result view={view} />;

  if (!view) {
    return (
      <div className="stack exam" style={{ paddingTop: 16 }}>
        <Link href="/play/tests" className="small">
          <Icon name="back" size={16} /> Tests
        </Link>
        <h1>{item.title}</h1>
        <div className="card stack">
          <div>
            <b>{item.questionCount} questions</b> · <b>{item.durationMinutes} minutes</b>
          </div>
          <ul style={{ margin: 0, paddingLeft: 20 }} className="small">
            <li>The timer starts when you press Start and keeps running if you close the page.</li>
            <li>Your answers save automatically. You can change them until you submit.</li>
            <li>Switching tabs, leaving full screen and pasting are recorded for the proctor.</li>
            {item.proctorLevel >= 2 && <li>Your camera takes a photo every minute. This test can only be taken on one device.</li>}
            {item.proctorLevel >= 3 && <li>The photos are checked automatically for other people or a phone. A proctor reviews anything flagged; nothing is decided automatically.</li>}
          </ul>
        </div>
        {error && <ErrorBox message={error} />}
        <button className="btn primary big" disabled={busy || item.state === "upcoming"} onClick={start}>
          {item.proctorLevel >= 2 ? "I agree, start the test" : "Start the test"}
        </button>
      </div>
    );
  }

  const q = view.questions[current]!;
  const d = drafts[q.question.id] ?? emptyDraft(q.question);
  const executes = d.kind === "code" || d.kind === "sql";
  const section = view.assessment.sections[q.section]!;
  const answered = (qid: string) => Boolean(drafts[qid] && draftToResponse(drafts[qid]!));
  const answeredCount = view.questions.filter((x) => answered(x.question.id)).length;

  return (
    <div className="stack exam" style={{ paddingBottom: 24 }}>
      <div className="spread" style={{ position: "sticky", top: 0, background: "var(--bg)", padding: "10px 0", zIndex: 5 }}>
        <div>
          <b>{view.assessment.title}</b>
          <div className="muted small">
            {answeredCount}/{view.questions.length} answered · {saveState === "saving" ? "Saving..." : saveState === "error" ? "Not saved" : "All changes saved"}
          </div>
        </div>
        <div className="row">
          <span className="kpi" style={{ fontSize: "1.3rem", color: timeLeft < 5 * 60_000 ? "var(--bad-ink)" : undefined }} role="timer">
            {fmt(timeLeft)}
          </span>
          <button className="btn primary small" disabled={busy} onClick={() => setConfirming(true)}>
            Submit
          </button>
        </div>
      </div>

      {cameraProblem && <ErrorBox message={cameraProblem} />}
      {confirming && (
        <div className="card stack" role="alertdialog" aria-label="Submit the test">
          <b>Submit now?</b>
          <span className="small">
            You have answered {answeredCount} of {view.questions.length}. You cannot change answers after submitting.
          </span>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={submit}>
              {busy ? "Submitting..." : "Submit test"}
            </button>
            <button className="btn ghost" onClick={() => setConfirming(false)}>
              Keep working
            </button>
          </div>
        </div>
      )}

      <nav className="row wrap" aria-label="Questions" style={{ gap: 6 }}>
        {view.questions.map((x, i) => (
          <button
            key={x.question.id}
            className={`btn small ${i === current ? "primary" : ""}`}
            style={{ minWidth: 40, background: i !== current && answered(x.question.id) ? "var(--good-soft)" : undefined }}
            aria-current={i === current ? "step" : undefined}
            aria-label={`Question ${i + 1}${answered(x.question.id) ? ", answered" : ""}`}
            onClick={() => {
              setCurrent(i);
              setRunResult(null);
            }}
          >
            {i + 1}
          </button>
        ))}
      </nav>

      <div className="row wrap" style={{ gap: 6 }}>
        <span className="pill">{section.title}</span>
        <span className="pill accent">{q.question.typeLabel}</span>
        <span className="muted small">
          {section.marks} mark{section.marks === 1 ? "" : "s"}
          {section.negative ? `, -${section.negative} if wrong` : ""}
        </span>
      </div>
      <h2 style={{ fontSize: "1.1rem", whiteSpace: "pre-line" }}>{q.question.body.stem}</h2>
      <QuestionInput key={q.question.id} question={q.question} draft={d} answer={null} onSubmit={() => {}} onChange={(nd) => change(q.question.id, nd)} />
      {executes && (
        <button className="btn" disabled={running || !draftToResponse(d)} onClick={() => run(q.question.id, d)}>
          {running ? "Running..." : d.kind === "code" ? "Run sample tests" : "Run query"}
        </button>
      )}
      {runResult && <EvaluationView evaluation={runResult} title="Sample tests" />}
      {draftToResponse(d) && !executes && (
        <button className="btn ghost small" onClick={() => change(q.question.id, emptyDraft(q.question))}>
          Clear answer
        </button>
      )}
      {error && <ErrorBox message={error} />}
      <div className="spread">
        <button className="btn" disabled={current === 0} onClick={() => setCurrent(current - 1)}>
          <Icon name="back" size={16} /> Previous
        </button>
        <button className="btn" disabled={current === view.questions.length - 1} onClick={() => setCurrent(current + 1)}>
          Next <Icon name="arrow" size={16} />
        </button>
      </div>
    </div>
  );
}
