"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { BAND_TONE } from "@/lib/aptitude";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

interface Hub {
  inProgress: string | null;
  sittings: { id: string; title: string; closesAt: string; attempt: { id: string; status: "in_progress" | "finished" } | null }[];
  official: { score: number; scores: Record<string, number>; at: string; band: string; bandLabel: string } | null;
  attempts: { id: string; official: boolean; score: number; scores: Record<string, number>; band: string; bandLabel: string; finishedAt: string }[];
  sections: { key: string; title: string; items: number; minutes: number }[];
  templates: { id: string; topic: "quant" | "reasoning"; label: string }[];
}

interface MyTopic {
  template: string;
  label: string;
  answered: number;
  correct: number;
  accuracyPct: number;
  drillLevel: number;
}

function TopicRow({ x }: { x: MyTopic }) {
  const t = useT();
  return (
    <div className="stack" style={{ gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <div className="spread wrap" style={{ gap: 8 }}>
        <div>
          <b>{t(x.label)}</b>
          <div className="small muted">{t("{right} of {n} right", { right: x.correct, n: x.answered })}</div>
        </div>
        <Link href={`/play/aptitude/drill?t=${x.template}&l=${x.drillLevel}`} className="btn small">
          {t("Drill at level {n}", { n: x.drillLevel })}
        </Link>
      </div>
      <Bar value={x.accuracyPct} tone={x.accuracyPct < 50 ? "bad" : x.accuracyPct < 70 ? "warn" : "good"} label={t("{label}: {pct}% right", { label: t(x.label), pct: x.accuracyPct })} />
    </div>
  );
}

/** How the student has done topic by topic, weakest first, with a drill pitched at each. */
function YourTopics() {
  const t = useT();
  const { data } = useApi<{ topics: MyTopic[]; untried: { id: string; label: string }[] }>("/student/aptitude/topics");
  if (!data?.topics.length) return null;
  // Enough answers to say something, and not going well.
  const weak = data.topics.filter((x) => x.answered >= 3 && x.accuracyPct < 70).slice(0, 3);
  return (
    <section className="card stack" aria-labelledby="h-topics">
      <div>
        <h2 id="h-topics" style={{ margin: 0 }}>
          {t("Your topics")}
        </h2>
        <p className="small muted" style={{ margin: 0 }}>
          {t("How you've done on each topic in the last 90 days, from tests, homework and drills.")}
        </p>
      </div>
      {weak.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">{t("Work on these")}</b>
          {weak.map((x) => (
            <TopicRow key={x.template} x={x} />
          ))}
        </div>
      )}
      <details>
        <summary className="small" style={{ cursor: "pointer" }}>
          {t("All topics you've tried ({n})", { n: data.topics.length })}
        </summary>
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          {data.topics.map((x) => (
            <TopicRow key={x.template} x={x} />
          ))}
        </div>
      </details>
      {data.untried.length > 0 && (
        <p className="small" style={{ margin: 0 }}>
          <span className="muted">{t("Not tried yet:")}</span>{" "}
          {data.untried.map((x, i) => (
            <span key={x.id}>
              {i > 0 && ", "}
              <Link href={`/play/aptitude/drill?t=${x.id}`}>{t(x.label)}</Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export default function AptitudeHub() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Hub>("/student/aptitude");
  const homework = useApi<{ homework: { id: string; title: string; dueAt: string; questions: number; answered: number; correct: number; done: boolean; topics: string[] }[] }>("/student/aptitude/homework");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  async function start(sittingId: string | null = null) {
    setBusy(true);
    setMsg(null);
    try {
      router.push(`/play/aptitude/test/${(await api<{ id: string }>("/student/aptitude/tests", { body: { sittingId } })).id}`);
    } catch (e) {
      setMsg(errorMessage(e));
      setBusy(false);
    }
  }
  const date = (d: string) => new Date(d).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short" });
  const title = (key: string) => t(data.sections.find((s) => s.key === key)?.title ?? key);
  return (
    <div className="stack">
      <Link href="/play/mocks" className="small">
        ← {t("Mock tests")}
      </Link>
      <div>
        <h1 style={{ margin: 0 }}>{t("Aptitude")}</h1>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          {t("Fresh questions every time, worked out for you, so practice never runs out.")}
        </p>
      </div>

      {data.sittings.map((s) => (
        <section key={s.id} className="card stack" style={{ borderColor: "var(--accent)", borderWidth: 2 }} aria-labelledby={`h-s-${s.id}`}>
          <div>
            <span className="pill accent">{t("Official")}</span>
            <h2 id={`h-s-${s.id}`} style={{ margin: "4px 0 0" }}>
              {s.title}
            </h2>
            <div className="small muted">
              {t("Open until {when}", { when: new Date(s.closesAt).toLocaleString(intlLocale(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}
            </div>
          </div>
          <p className="small" style={{ margin: 0 }}>
            {t("One attempt, in one go. Your score goes on your resume and counts for drives that ask for a minimum score.")}
          </p>
          {s.attempt?.status === "finished" ? (
            <Link href={`/play/aptitude/test/${s.attempt.id}`} className="small">
              {t("Done: see your result")}
            </Link>
          ) : (
            <div>
              <button className="btn primary" disabled={busy} onClick={() => start(s.id)}>
                {t(s.attempt ? "Continue the official test" : "Start the official test")}
              </button>
            </div>
          )}
        </section>
      ))}

      {(homework.data?.homework.length ?? 0) > 0 && (
        <section className="card stack" aria-labelledby="h-homework">
          <h2 id="h-homework" style={{ margin: 0 }}>
            {t("Homework")}
          </h2>
          {homework.data!.homework.map((h) => (
            <Link key={h.id} href={`/play/aptitude/homework/${h.id}`} className="spread" style={{ color: "inherit", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div>
                <b>{h.title}</b>
                <div className="small muted">
                  {h.topics.map((x) => t(x)).join(", ")} · {t("due {when}", { when: date(h.dueAt) })}
                </div>
              </div>
              {h.done ? (
                <span className="pill good">
                  {h.correct}/{h.questions}
                </span>
              ) : (
                <span className={`pill ${new Date(h.dueAt) < new Date() ? "bad" : "warn"}`}>{h.answered ? `${h.answered}/${h.questions}` : t("To do")}</span>
              )}
            </Link>
          ))}
        </section>
      )}

      {data.official && (
        <div className="card spread wrap" style={{ gap: 8 }}>
          <div>
            <div className="small muted">{t("Your official score")}</div>
            <b style={{ fontSize: 24 }}>{data.official.score}</b> <span className={`pill ${BAND_TONE[data.official.band]}`}>{t(data.official.bandLabel)}</span>
          </div>
          <div className="small muted" style={{ maxWidth: 260 }}>
            {t("On your resume since {date}. Practice tests don't change it.", { date: date(data.official.at) })}
          </div>
        </div>
      )}

      <section className="card accent stack" aria-labelledby="h-adaptive">
        <h2 id="h-adaptive" style={{ margin: 0 }}>
          {t("Adaptive aptitude test")}
        </h2>
        <p className="small" style={{ margin: 0 }}>
          {t("Questions get harder when you answer right and easier when you don't, like the adaptive tests many companies use. Scored from 100 to 900.")}
        </p>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {data.sections.map((s) => (
            <li key={s.key}>{t("{title}: {n} questions, {m} minutes", { title: t(s.title), n: s.items, m: s.minutes })}</li>
          ))}
          <li>{t("You can't skip or go back, and questions you don't reach in time count as wrong.")}</li>
        </ul>
        <div>
          <button className="btn big" style={{ color: "var(--accent)" }} disabled={busy} onClick={() => start()}>
            {t(data.inProgress ? "Resume the test" : "Start a practice test")}
          </button>
        </div>
        {msg && <ErrorBox message={msg} />}
      </section>

      {data.attempts.length > 0 && (
        <section className="card stack" aria-labelledby="h-scores">
          <h2 id="h-scores" style={{ margin: 0 }}>
            {t("Your scores")}
          </h2>
          {data.attempts.map((a) => (
            <Link key={a.id} href={`/play/aptitude/test/${a.id}`} className="spread" style={{ color: "inherit", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div>
                <b style={{ fontSize: 20 }}>{a.score}</b> <span className={`pill ${BAND_TONE[a.band]}`}>{t(a.bandLabel)}</span> {a.official && <span className="pill accent">{t("Official")}</span>}
                <div className="small muted">
                  {date(a.finishedAt)} ·{" "}
                  {Object.entries(a.scores)
                    .map(([k, v]) => `${title(k)} ${v}`)
                    .join(" · ")}
                </div>
              </div>
              <Icon name="arrow" />
            </Link>
          ))}
        </section>
      )}

      <YourTopics />

      <section className="card stack" aria-labelledby="h-drills">
        <div>
          <h2 id="h-drills" style={{ margin: 0 }}>
            {t("Drills")}
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            {t("Unlimited questions on one topic, with the working shown. They get harder as you get them right.")}
          </p>
        </div>
        {(["quant", "reasoning"] as const).map((topic) => (
          <div key={topic} className="stack" style={{ gap: 6 }}>
            <b className="small">{title(topic)}</b>
            <div className="row wrap" style={{ gap: 6 }}>
              {data.templates
                .filter((x) => x.topic === topic)
                .map((x) => (
                  <Link key={x.id} href={`/play/aptitude/drill?t=${x.id}`} className="btn small">
                    {t(x.label)}
                  </Link>
                ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
