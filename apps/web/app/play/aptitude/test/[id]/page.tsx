"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { DataTable } from "@playcode/core";
import { QuestionTable } from "@/components/QuestionTable";
import { ErrorBox, Loading } from "@/components/ui";
import { api, ApiError, errorMessage, useApi } from "@/lib/api";
import { BAND_TONE } from "@/lib/aptitude";
import { useT } from "@/lib/i18n";

interface Running {
  id: string;
  status: "in_progress";
  official: boolean;
  section: { index: number; total: number; key: string; title: string; items: number; minutes: number; deadline: string };
  question: { number: number; prompt: string; options: string[]; table: DataTable | null };
}
interface Item {
  prompt: string;
  table: DataTable | null;
  options: string[];
  answer: number;
  chosen: number | null;
  correct: boolean | null;
  level: number;
  template: string;
  explanation: string;
}
interface Finished {
  id: string;
  status: "finished";
  official: boolean;
  score: number;
  band: string;
  bandLabel: string;
  percentile: number | null;
  others: number;
  sections: { key: string; title: string; score: number; band: string; bandLabel: string; range: [number, number]; answered: number; correct: number; notReached: number; highestLevel: number; items: Item[] }[];
}
type View = Running | Finished;

function Clock({ deadline, onEnd }: { deadline: string; onEnd: () => void }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, new Date(deadline).getTime() - now);
  useEffect(() => {
    if (left === 0) onEnd();
  }, [left === 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <span className={`pill ${left < 60_000 ? "bad" : ""}`} role="timer" aria-label={t("Time left in this section")}>
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

function Question({ v, onNext }: { v: Running; onNext: (v: View) => void }) {
  const t = useT();
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function next() {
    if (chosen === null) return;
    setBusy(true);
    setMsg(null);
    try {
      onNext(await api<View>(`/student/aptitude/tests/${v.id}/answer`, { body: { number: v.question.number, chosen } }));
    } catch (e) {
      // Time ran out or the answer was already in: show where things stand now.
      if (e instanceof ApiError && e.status === 409) onNext(await api<View>(`/student/aptitude/tests/${v.id}`));
      else setMsg(errorMessage(e));
    }
    setBusy(false);
  }
  return (
    <div className="stack">
      <div className="spread">
        <div className="small muted">
          {v.official && <span className="pill accent">{t("Official")}</span>} {t("Section {n} of {total}", { n: v.section.index + 1, total: v.section.total })} · {t(v.section.title)}
        </div>
        <Clock deadline={v.section.deadline} onEnd={() => api<View>(`/student/aptitude/tests/${v.id}`).then(onNext, () => {})} />
      </div>
      <fieldset className="card stack" style={{ margin: 0 }}>
        <legend className="small muted" style={{ padding: 0 }}>
          {t("Question {n} of {total}", { n: v.question.number, total: v.section.items })}
        </legend>
        <p style={{ margin: 0, fontWeight: 600, whiteSpace: "pre-line" }}>{v.question.prompt}</p>
        <QuestionTable table={v.question.table} />
        {v.question.options.map((o, i) => (
          <label key={i} className="card tight row" style={{ gap: 8, cursor: "pointer", borderColor: chosen === i ? "var(--accent)" : undefined }}>
            <input type="radio" name="option" style={{ width: "auto" }} checked={chosen === i} onChange={() => setChosen(i)} />
            {o}
          </label>
        ))}
      </fieldset>
      {msg && <ErrorBox message={msg} />}
      <button className="btn primary big" disabled={busy || chosen === null} onClick={next}>
        {t(v.question.number === v.section.items ? (v.section.index + 1 === v.section.total ? "Finish the test" : "Next section") : "Next")}
      </button>
      <p className="small muted" style={{ margin: 0 }}>
        {t("You can't skip or go back, and questions you don't reach in time count as wrong.")}
      </p>
    </div>
  );
}

function Result({ v }: { v: Finished }) {
  const t = useT();
  return (
    <div className="stack">
      <Link href="/play/aptitude" className="small">
        ← {t("Aptitude")}
      </Link>
      <div className="card accent stack" style={{ gap: 4 }}>
        <div className="small">{t(v.official ? "Your official score" : "Your score")}</div>
        <div>
          <b style={{ fontSize: 40 }}>{v.score}</b> <span className="small">/ 900</span>
        </div>
        <div>
          <span className="pill">{t(v.bandLabel)}</span>
        </div>
        <div className="small">
          {v.percentile === null ? t("Your percentile appears once 20 students have taken this test.") : t("You scored higher than {p}% of the {n} other students who have taken this test (their latest attempt).", { p: v.percentile, n: v.others })}
        </div>
      </div>
      {v.sections.map((s) => (
        <section key={s.key} className="card stack" aria-labelledby={`h-${s.key}`}>
          <div className="spread">
            <h2 id={`h-${s.key}`} style={{ margin: 0 }}>
              {t(s.title)}
            </h2>
            <span>
              <b style={{ fontSize: 22 }}>{s.score}</b> <span className={`pill ${BAND_TONE[s.band]}`}>{t(s.bandLabel)}</span>
            </span>
          </div>
          <div className="small muted">
            {t("Likely between {lo} and {hi}", { lo: s.range[0], hi: s.range[1] })} · {t("{right} of {n} right", { right: s.correct, n: s.answered })}
            {s.notReached > 0 ? ` · ${t("{n} not reached", { n: s.notReached })}` : ""}
            {s.highestLevel > 0 ? ` · ${t("hardest answered right: level {n} of 5", { n: s.highestLevel })}` : ""}
          </div>
          <details>
            <summary className="small">{t("Review your answers")}</summary>
            <ol className="stack" style={{ paddingLeft: 18, marginTop: 8, gap: 10 }}>
              {s.items.map((i, n) => (
                <li key={n} className="small">
                  <div style={{ whiteSpace: "pre-line" }}>{i.prompt}</div>
                  <QuestionTable table={i.table} />
                  <div style={{ color: i.correct ? "var(--good-ink)" : "var(--bad-ink)" }}>
                    {i.chosen === null ? t("Not answered") : i.correct ? `✓ ${i.options[i.chosen]}` : `✗ ${i.options[i.chosen]}`}
                    {!i.correct && ` · ${t("Correct answer:")} ${i.options[i.answer]}`}
                  </div>
                  <div className="muted">{i.explanation}</div>
                  {!i.correct && (
                    <Link href={`/play/aptitude/drill?t=${i.template}`} className="small">
                      {t("Practise this")}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </details>
        </section>
      ))}
    </div>
  );
}

export default function AdaptiveTest() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload, setData } = useApi<View>(`/student/aptitude/tests/${id}`);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox message={t("Could not load")} onRetry={reload} />;
  // A new key per question, so the choice resets.
  return data.status === "in_progress" ? <Question key={`${data.section.index}-${data.question.number}`} v={data} onNext={setData} /> : <Result v={data} />;
}
