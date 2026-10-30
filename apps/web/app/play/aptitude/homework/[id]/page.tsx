"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

interface Answered {
  index: number;
  topic: string;
  prompt: string;
  options: string[];
  chosen: number;
  answer: number;
  correct: boolean;
  explanation: string;
}
interface Homework {
  id: string;
  title: string;
  dueAt: string;
  overdue: boolean;
  total: number;
  correct: number;
  done: boolean;
  answered: Answered[];
  next: { index: number; topic: string; level: number; prompt: string; options: string[] } | null;
  topics: { label: string; answered: number; correct: number }[];
}

export default function HomeworkPage() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload, setData } = useApi<Homework>(`/student/aptitude/homework/${id}`);
  const [chosen, setChosen] = useState<number | null>(null);
  const [last, setLast] = useState<Answered | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const h = data;
  async function check() {
    if (!h.next || chosen === null) return;
    setBusy(true);
    setMsg(null);
    try {
      const v = await api<Homework>(`/student/aptitude/homework/${id}/answer`, { body: { index: h.next.index, chosen } });
      setLast(v.answered.find((a) => a.index === h.next!.index) ?? null);
      setData(v);
    } catch (e) {
      setMsg(errorMessage(e));
    }
    setBusy(false);
  }
  const due = new Date(h.dueAt).toLocaleString(intlLocale(locale), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const progress = h.answered.length;
  return (
    <div className="stack">
      <Link href="/play/aptitude" className="small">
        ← {t("Aptitude")}
      </Link>
      <div>
        <h1 style={{ margin: 0 }}>{h.title}</h1>
        <div className="small muted">
          {t(h.overdue ? "Was due {date}" : "Due {date}", { date: due })} · {t("{n} of {total} answered", { n: progress, total: h.total })}
        </div>
        <Bar value={(progress / h.total) * 100} />
      </div>
      {last && (
        <div className="card stack" style={{ gap: 4, borderColor: last.correct ? "var(--good)" : "var(--bad)" }} role="status">
          <b style={{ color: last.correct ? "var(--good-ink)" : "var(--bad-ink)" }}>{t(last.correct ? "Correct!" : "Not quite")}</b>
          {!last.correct && (
            <div className="small">
              {t("Correct answer:")} {last.options[last.answer]}
            </div>
          )}
          <div className="small">{last.explanation}</div>
        </div>
      )}
      {h.next ? (
        <fieldset key={h.next.index} className="card stack" style={{ margin: 0 }}>
          <legend className="small muted" style={{ padding: 0 }}>
            {t("Question {n} of {total}", { n: h.next.index + 1, total: h.total })} · {t(h.next.topic)}
          </legend>
          <p style={{ margin: 0, fontWeight: 600 }}>{h.next.prompt}</p>
          {h.next.options.map((o, i) => (
            <label key={i} className="card tight row" style={{ gap: 8, cursor: "pointer", borderColor: chosen === i ? "var(--accent)" : undefined }}>
              <input
                type="radio"
                name="option"
                style={{ width: "auto" }}
                checked={chosen === i}
                onChange={() => {
                  setChosen(i);
                  setLast(null);
                }}
              />
              {o}
            </label>
          ))}
          {msg && <ErrorBox message={msg} />}
          <button
            className="btn primary"
            disabled={busy || chosen === null}
            onClick={async () => {
              await check();
              setChosen(null);
            }}
          >
            {t("Check")}
          </button>
        </fieldset>
      ) : (
        <section className="card accent stack" aria-labelledby="h-done">
          <h2 id="h-done" style={{ margin: 0 }}>
            {t("Done: {right} of {n} right", { right: h.correct, n: h.total })}
          </h2>
          {h.topics.map((x) => (
            <div key={x.label} className="spread small">
              <span>{t(x.label)}</span>
              <b>
                {x.correct}/{x.answered}
              </b>
            </div>
          ))}
        </section>
      )}
      {h.answered.length > 0 && (
        <details>
          <summary className="small">{t("Review your answers")}</summary>
          <ol className="stack" style={{ paddingLeft: 18, marginTop: 8, gap: 10 }}>
            {h.answered.map((a) => (
              <li key={a.index} className="small">
                <div>{a.prompt}</div>
                <div style={{ color: a.correct ? "var(--good-ink)" : "var(--bad-ink)" }}>
                  {a.correct ? "✓" : "✗"} {a.options[a.chosen]}
                  {!a.correct && ` · ${t("Correct answer:")} ${a.options[a.answer]}`}
                </div>
                <div className="muted">{a.explanation}</div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
