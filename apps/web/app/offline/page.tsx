"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { draftToResponse, QuestionInput, responseToDraft, type Draft } from "@/components/QuestionInput";
import { ErrorBox } from "@/components/ui";
import { api, errorMessage, getToken } from "@/lib/api";
import { LocaleProvider, useT, type Locale } from "@/lib/i18n";
import { loadStoredPack, saveStoredPack, type OfflinePack, type StoredPack } from "@/lib/offline";
import type { Me, QuestionView } from "@/lib/types";

// /offline sits outside the signed-in app shell, which needs the API to load:
// this page works from the service worker's copy with no connection at all.

interface SyncResult {
  correct: number;
  total: number;
  xp: number;
  results: { questionId: string; stem: string; code: string | null; correct: boolean; correctAnswer: string; explanation: string }[];
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function Practice({ stored, setStored, online }: { stored: StoredPack | null; setStored: (s: StoredPack | null) => void; online: boolean }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const shownAt = useRef(Date.now());

  const questions = (stored?.pack.questions ?? []).map((q) => ({ ...q, hintsUsed: 0, coachUsed: 0 }) as QuestionView);
  const q = questions[index];
  useEffect(() => {
    if (!q) return;
    shownAt.current = Date.now();
    setDraft(responseToDraft(q, stored?.answers[q.id]?.response ?? null));
  }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const [pack, me] = await Promise.all([api<OfflinePack>("/student/offline-pack", { body: {} }), api<Me>("/me")]);
      const next: StoredPack = { pack, answers: stored?.pack.id === pack.id ? stored.answers : {}, locale: (me.user.locale ?? "en") as Locale };
      saveStoredPack(next);
      setStored(next);
      setIndex(0);
      setResult(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!stored || !q || !draft) return;
    const response = draftToResponse(draft);
    if (!response) return setError(t("Choose or write an answer first."));
    setError(null);
    const previous = stored.answers[q.id];
    const next: StoredPack = {
      ...stored,
      answers: { ...stored.answers, [q.id]: { questionId: q.id, response, answeredAt: previous?.answeredAt ?? new Date().toISOString(), timeMs: Math.min(3_600_000, (previous?.timeMs ?? 0) + Date.now() - shownAt.current) } },
    };
    saveStoredPack(next);
    setStored(next);
    if (index < questions.length - 1) setIndex(index + 1);
  }

  async function sync() {
    if (!stored) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<SyncResult>(`/student/offline-pack/${stored.pack.id}/sync`, { body: { answers: Object.values(stored.answers) } });
      saveStoredPack(null);
      setStored(null);
      setResult(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const answered = stored ? Object.keys(stored.answers).length : 0;
  return (
    <main className="stack" style={{ maxWidth: 720, margin: "0 auto", padding: "16px 16px 48px" }}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>{t("Offline practice")}</h1>
        <span className={`pill ${online ? "good" : "warn"}`} role="status">
          {online ? t("Online") : t("Offline")}
        </span>
      </div>

      {result && (
        <section className="card stack" aria-labelledby="offline-result">
          <h2 id="offline-result" style={{ margin: 0 }}>
            {t("{right} of {total} right · +{xp} XP", { right: result.correct, total: result.total, xp: result.xp })}
          </h2>
          <ol className="stack small" style={{ margin: 0, paddingLeft: 20 }}>
            {result.results.map((r) => (
              <li key={r.questionId}>
                <div style={{ whiteSpace: "pre-line", fontWeight: 600 }}>{r.stem}</div>
                {r.code && <CodeBlock code={r.code} />}
                <div style={{ color: r.correct ? "var(--good-ink)" : "var(--bad-ink)" }}>{r.correct ? `✓ ${t("Right")}` : `✗ ${t("Correct answer:")} ${r.correctAnswer}`}</div>
                {!r.correct && <div className="muted">{r.explanation}</div>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {!getToken() ? (
        <div className="card stack">
          <p style={{ margin: 0 }}>{t("Sign in while you're online, then come back here to download questions.")}</p>
          <Link href="/login" className="btn primary" style={{ alignSelf: "flex-start" }}>
            {t("Sign in")}
          </Link>
        </div>
      ) : !stored ? (
        <div className="card stack">
          <p style={{ margin: 0 }}>
            {t("Download 15 questions on your weak skills to answer with no signal: on the bus, the train or in a hostel. Your answers are checked when you're back online, and count towards your streak, XP and mastery like any practice.")}
          </p>
          <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!online || busy} onClick={download}>
            {busy ? t("Downloading...") : result ? t("Download another pack") : t("Download questions")}
          </button>
          {!online && <div className="small muted">{t("Connect to the internet to download a pack.")}</div>}
          <Link href="/play" className="small">
            {t("Back to PlayCode")}
          </Link>
        </div>
      ) : (
        <>
          <div className="card spread wrap">
            <div className="small">
              {t("{n} of {total} answered", { n: answered, total: questions.length })}
              <div className="muted">{t("Answers are saved on this phone until you check them.")}</div>
            </div>
            <button className="btn primary" disabled={!online || busy || answered === 0} onClick={sync}>
              {busy ? t("Checking...") : t("Check my answers")}
            </button>
          </div>
          {!online && answered > 0 && <div className="small muted">{t("Connect to the internet to check your answers.")}</div>}
          <nav className="row wrap" aria-label={t("Questions")} style={{ gap: 6 }}>
            {questions.map((x, i) => (
              <button
                key={x.id}
                className={`btn small ${i === index ? "primary" : ""}`}
                style={{ minWidth: 40, background: i !== index && stored.answers[x.id] ? "var(--good-soft)" : undefined }}
                aria-current={i === index ? "step" : undefined}
                aria-label={`${t("Question {n}", { n: i + 1 })}${stored.answers[x.id] ? `, ${t("answered")}` : ""}`}
                onClick={() => setIndex(i)}
              >
                {i + 1}
              </button>
            ))}
          </nav>
          {q && draft && (
            <section className="stack" aria-label={t("Question {n}", { n: index + 1 })}>
              <div className="pill accent" style={{ alignSelf: "flex-start" }}>
                {q.typeLabel}
              </div>
              <h2 style={{ fontSize: "1.1rem", whiteSpace: "pre-line", margin: 0 }}>{q.body.stem}</h2>
              <QuestionInput key={q.id} question={q} draft={draft} answer={null} onSubmit={save} onChange={setDraft} />
              <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={save}>
                {stored.answers[q.id] ? t("Update answer") : t("Save answer")}
              </button>
            </section>
          )}
        </>
      )}
      {error && <ErrorBox message={error} />}
    </main>
  );
}

export default function OfflinePage() {
  const [stored, setStored] = useState<StoredPack | null>(null);
  const [ready, setReady] = useState(false);
  const online = useOnline();
  useEffect(() => {
    setStored(loadStoredPack());
    setReady(true);
  }, []);
  if (!ready) return null;
  return (
    <LocaleProvider locale={stored?.locale ?? "en"}>
      <Practice stored={stored} setStored={setStored} online={online} />
    </LocaleProvider>
  );
}
