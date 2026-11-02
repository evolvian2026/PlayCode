"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { DataTable } from "@playcode/core";
import { QuestionTable } from "@/components/QuestionTable";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

interface Mistake {
  key: string;
  template: string;
  topic: string;
  level: number;
  seed: number;
  from: "test" | "homework" | "drill";
  at: string;
  prompt: string;
  table: DataTable | null;
  options: string[];
  chosen: number | null;
  answer: number;
  explanation: string;
}
interface Drill {
  template: string;
  level: number;
  seed: number;
  prompt: string;
  table: DataTable | null;
  options: string[];
}
interface Checked {
  correct: boolean;
  answer: number;
  explanation: string;
  fixed: boolean;
}

const FROM = { test: "From a test", homework: "From homework", drill: "From a drill" } as const;

/** A fresh question on the same topic and level; right puts the mistake right. */
function Retry({ m, onFixed }: { m: Mistake; onFixed: () => void }) {
  const t = useT();
  const [q, setQ] = useState<Drill | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const shownAt = useRef(0);
  async function load() {
    setMsg(null);
    setChosen(null);
    setChecked(null);
    try {
      setQ(await api<Drill>(`/student/aptitude/drill?template=${m.template}&level=${m.level}`));
      shownAt.current = Date.now();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  async function check() {
    if (!q || chosen === null) return;
    try {
      const seconds = Math.max(1, Math.round((Date.now() - shownAt.current) / 1000));
      const c = await api<Checked>("/student/aptitude/drill/check", { body: { template: q.template, level: q.level, seed: q.seed, chosen, seconds, retryOf: { seed: m.seed } } });
      setChecked(c);
      if (c.fixed) onFixed();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  if (!q)
    return (
      <div>
        {msg && <ErrorBox message={msg} />}
        <button className="btn primary small" onClick={load}>
          {t("Try a similar one")}
        </button>
      </div>
    );
  return (
    <fieldset className="card tight stack" style={{ margin: 0, background: "var(--surface-2)" }}>
      <legend className="small" style={{ fontWeight: 600 }}>
        {t("A similar question")}
      </legend>
      <p style={{ margin: 0, fontWeight: 600, whiteSpace: "pre-line" }}>{q.prompt}</p>
      <QuestionTable table={q.table} />
      {q.options.map((o, i) => {
        const mark = checked ? (i === checked.answer ? "var(--good)" : i === chosen ? "var(--bad)" : undefined) : chosen === i ? "var(--accent)" : undefined;
        return (
          <label key={i} className="card tight row" style={{ gap: 8, cursor: checked ? "default" : "pointer", borderColor: mark }}>
            <input type="radio" name={`retry-${m.key}`} style={{ width: "auto" }} checked={chosen === i} disabled={Boolean(checked)} onChange={() => setChosen(i)} />
            {o}
          </label>
        );
      })}
      {msg && <ErrorBox message={msg} />}
      {checked && (
        <div className="stack" style={{ gap: 4 }} role="status">
          <b style={{ color: checked.correct ? "var(--good-ink)" : "var(--bad-ink)" }}>{t(checked.correct ? "Right, and that one's off your list." : "Not quite")}</b>
          <div className="small">{checked.explanation}</div>
        </div>
      )}
      {!checked ? (
        <button className="btn primary" disabled={chosen === null} onClick={check}>
          {t("Check")}
        </button>
      ) : (
        !checked.correct && (
          <button className="btn" onClick={load}>
            {t("Try another")}
          </button>
        )
      )}
    </fieldset>
  );
}

export default function AptitudeMistakes() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload } = useApi<{ total: number; mistakes: Mistake[] }>("/student/aptitude/mistakes");
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const left = data.total - fixed.size;
  return (
    <div className="stack">
      <Link href="/play/aptitude" className="small">
        ← {t("Aptitude")}
      </Link>
      <div>
        <h1 style={{ margin: 0 }}>{t("Mistakes to retry")}</h1>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          {t("Questions you got wrong in the last 90 days. Get a similar one right to clear it.")}
        </p>
        <p className="small" style={{ margin: "4px 0 0" }} aria-live="polite">
          <b>{t("{n} left", { n: left })}</b>
          {data.total > data.mistakes.length && <span className="muted"> · {t("showing the latest {n}", { n: data.mistakes.length })}</span>}
        </p>
      </div>
      {data.mistakes.length === 0 && (
        <div className="card stack">
          <b>{t("Nothing to retry.")}</b>
          <Link href="/play/aptitude" className="small">
            {t("Back to drills and tests")}
          </Link>
        </div>
      )}
      {data.mistakes.map((m) => {
        const done = fixed.has(m.key);
        return (
          <section key={m.key} className="card stack" aria-labelledby={`h-${m.key}`} style={done ? { borderColor: "var(--good)" } : undefined}>
            <div className="spread wrap" style={{ gap: 6 }}>
              <h2 id={`h-${m.key}`} style={{ margin: 0, fontSize: 16 }}>
                {t(m.topic)}
              </h2>
              <span className="small muted">
                {t(FROM[m.from])} · {new Date(m.at).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short" })} · {t("Level {n}", { n: m.level })}
              </span>
            </div>
            {done && <span className="pill good">{t("Cleared")}</span>}
            <p style={{ margin: 0, whiteSpace: "pre-line" }}>{m.prompt}</p>
            <QuestionTable table={m.table} />
            <div className="small">
              {m.chosen !== null && (
                <div style={{ color: "var(--bad-ink)" }}>
                  ✗ {t("Your answer:")} {m.options[m.chosen]}
                </div>
              )}
              <div style={{ color: "var(--good-ink)" }}>
                ✓ {t("Correct answer:")} {m.options[m.answer]}
              </div>
            </div>
            <details>
              <summary className="small">{t("See the working")}</summary>
              <p className="small" style={{ margin: "6px 0 0" }}>
                {m.explanation}
              </p>
            </details>
            {!done && <Retry m={m} onFixed={() => setFixed((f) => new Set([...f, m.key]))} />}
          </section>
        );
      })}
    </div>
  );
}
