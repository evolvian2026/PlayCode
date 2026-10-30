"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { APTITUDE_TEMPLATES, type DataTable } from "@playcode/core";
import { QuestionTable } from "@/components/QuestionTable";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";

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
}

function DrillPage() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const template = params.get("t") ?? APTITUDE_TEMPLATES[0]!.id;
  // A link from "Your topics" says which level to start at.
  const start = Math.min(5, Math.max(1, Number(params.get("l")) || 2));
  const meta = APTITUDE_TEMPLATES.find((x) => x.id === template) ?? APTITUDE_TEMPLATES[0]!;
  const [level, setLevel] = useState(start);
  const [q, setQ] = useState<Drill | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [run, setRun] = useState(0);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [msg, setMsg] = useState<string | null>(null);

  async function load(lvl: number) {
    setMsg(null);
    setChosen(null);
    setChecked(null);
    try {
      setQ(await api<Drill>(`/student/aptitude/drill?template=${meta.id}&level=${lvl}`));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  useEffect(() => {
    setLevel(start);
    setRun(0);
    setScore({ right: 0, total: 0 });
    void load(start);
  }, [meta.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function check() {
    if (!q || chosen === null) return;
    try {
      const c = await api<Checked>("/student/aptitude/drill/check", { body: { template: q.template, level: q.level, seed: q.seed, chosen } });
      setChecked(c);
      setScore((s) => ({ right: s.right + (c.correct ? 1 : 0), total: s.total + 1 }));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  function next() {
    // Two right in a row moves up a level; a wrong answer moves down one.
    const streak = checked?.correct ? run + 1 : 0;
    const lvl = checked?.correct ? (streak >= 2 ? Math.min(5, level + 1) : level) : Math.max(1, level - 1);
    setRun(streak >= 2 ? 0 : streak);
    setLevel(lvl);
    void load(lvl);
  }

  return (
    <div className="stack">
      <Link href="/play/aptitude" className="small">
        ← {t("Aptitude")}
      </Link>
      <div className="spread wrap" style={{ gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>{t(meta.label)}</h1>
          <div className="small muted">
            {t("Level {n} of 5", { n: level })} · {t("{right} of {n} right", { right: score.right, n: score.total })}
          </div>
        </div>
        <label className="small">
          <span className="sr-only">{t("Topic")}</span>
          <select value={meta.id} onChange={(e) => router.replace(`/play/aptitude/drill?t=${e.target.value}`)}>
            {APTITUDE_TEMPLATES.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {msg && <ErrorBox message={msg} />}
      {!q ? (
        <Loading />
      ) : (
        <fieldset className="card stack" style={{ margin: 0 }}>
          <legend className="sr-only">{t("Question")}</legend>
          <p style={{ margin: 0, fontWeight: 600, whiteSpace: "pre-line" }}>{q.prompt}</p>
          <QuestionTable table={q.table} />
          {q.options.map((o, i) => {
            const mark = checked ? (i === checked.answer ? "var(--good)" : i === chosen ? "var(--bad)" : undefined) : chosen === i ? "var(--accent)" : undefined;
            return (
              <label key={i} className="card tight row" style={{ gap: 8, cursor: checked ? "default" : "pointer", borderColor: mark }}>
                <input type="radio" name="option" style={{ width: "auto" }} checked={chosen === i} disabled={Boolean(checked)} onChange={() => setChosen(i)} />
                {o}
              </label>
            );
          })}
          {checked && (
            <div className="stack" style={{ gap: 4 }} role="status">
              <b style={{ color: checked.correct ? "var(--good-ink)" : "var(--bad-ink)" }}>{t(checked.correct ? "Correct!" : "Not quite")}</b>
              <div className="small">{checked.explanation}</div>
            </div>
          )}
          {checked ? (
            <button className="btn primary" onClick={next}>
              {t("Next question")}
            </button>
          ) : (
            <button className="btn primary" disabled={chosen === null} onClick={check}>
              {t("Check")}
            </button>
          )}
        </fieldset>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <DrillPage />
    </Suspense>
  );
}
