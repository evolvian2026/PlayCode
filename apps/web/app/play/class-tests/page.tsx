"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

interface List {
  tests: { id: string; title: string; score: number; marks: number; pct: number; enteredAt: string }[];
}

interface Detail {
  id: string;
  title: string;
  set: "A" | "B" | null;
  score: number;
  marks: number;
  classAverage: number | null;
  items: { n: number; type: string; skill: string; stem: string; code: string | null; outcome: "right" | "wrong" | "blank"; yourAnswer: string | null; correctAnswer: string; explanation: string }[];
}

const OUTCOME = { right: ["good", "Right"], wrong: ["bad", "Wrong"], blank: ["warn", "Not answered"] } as const;

function Result({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT();
  const { data, error, loading, reload } = useApi<Detail>(`/student/class-tests/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const right = data.items.filter((i) => i.outcome === "right").length;
  return (
    <div className="stack">
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← {t("Class tests")}
        </button>
        <h1 style={{ margin: "6px 0 0" }}>{data.title}</h1>
        <div className="small muted">{data.set ? t("Set {set}", { set: data.set }) : null}</div>
      </div>
      <div className="card spread">
        <div>
          <div className="kpi">
            {data.score}/{data.marks}
          </div>
          <div className="small muted">{t("{right} of {n} questions right", { right, n: data.items.length })}</div>
        </div>
        {data.classAverage !== null && <div className="small muted">{t("Class average {n}", { n: data.classAverage })}</div>}
      </div>
      {data.items.map((q) => {
        const [tone, label] = OUTCOME[q.outcome];
        return (
          <div key={q.n} className="card stack" style={{ gap: 8 }}>
            <div className="spread">
              <b>{t("Question {n}", { n: q.n })}</b>
              <span className={`pill ${tone}`}>{t(label)}</span>
            </div>
            <div className="small muted">
              {q.type} · {q.skill}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{q.stem}</div>
            {q.code && <CodeBlock code={q.code} />}
            {q.yourAnswer && q.outcome !== "right" && (
              <div className="small">
                <b>{t("Your answer:")}</b> {q.yourAnswer}
              </div>
            )}
            <div className="small">
              <b>{t("Correct answer:")}</b> <span style={{ whiteSpace: "pre-wrap" }}>{q.correctAnswer}</span>
            </div>
            <div className="small muted">{q.explanation}</div>
          </div>
        );
      })}
    </div>
  );
}

function ClassTests() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const id = useSearchParams().get("id");
  const list = useApi<List>(id ? null : "/student/class-tests");
  if (id) return <Result id={id} onBack={() => router.push("/play/class-tests")} />;
  if (list.loading && !list.data) return <Loading />;
  if (list.error || !list.data) return <ErrorBox message={list.error?.message ?? t("Could not load")} onRetry={list.reload} />;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Class tests")}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {t("Marks from tests you took on paper in class, with every question, your answer and the right one.")}
      </p>
      {list.data.tests.length === 0 ? (
        <div className="card muted">{t("No class test results yet. They appear here when your teacher enters the marks.")}</div>
      ) : (
        list.data.tests.map((x) => (
          <button key={x.id} className="card spread" style={{ textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }} onClick={() => router.push(`/play/class-tests?id=${x.id}`)}>
            <div>
              <b>{x.title}</b>
              <div className="small muted">{new Date(x.enteredAt).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
            </div>
            <span className={`pill ${x.pct >= 70 ? "good" : x.pct >= 40 ? "warn" : "bad"}`}>
              {x.score}/{x.marks}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

export default function ClassTestsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ClassTests />
    </Suspense>
  );
}
