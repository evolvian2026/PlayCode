"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { BAND_TONE } from "@/lib/aptitude";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

interface Hub {
  inProgress: string | null;
  attempts: { id: string; score: number; scores: Record<string, number>; band: string; bandLabel: string; finishedAt: string }[];
  sections: { key: string; title: string; items: number; minutes: number }[];
  templates: { id: string; topic: "quant" | "reasoning"; label: string }[];
}

export default function AptitudeHub() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Hub>("/student/aptitude");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  async function start() {
    setBusy(true);
    setMsg(null);
    try {
      router.push(`/play/aptitude/test/${(await api<{ id: string }>("/student/aptitude/tests", { body: {} })).id}`);
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
          <button className="btn big" style={{ color: "var(--accent)" }} disabled={busy} onClick={start}>
            {t(data.inProgress ? "Resume the test" : "Start the test")}
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
                <b style={{ fontSize: 20 }}>{a.score}</b> <span className={`pill ${BAND_TONE[a.band]}`}>{t(a.bandLabel)}</span>
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
