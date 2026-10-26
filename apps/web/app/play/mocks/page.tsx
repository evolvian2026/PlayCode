"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading, masteryTone } from "@/components/ui";
import { api, ApiError, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

interface MocksResponse {
  patterns: { id: string; name: string; description: string; minutes: number; sections: { title: string; minutes: number; count: number; kind: "quick" | "coding" }[] }[];
  attempts: { id: string; pattern: string; startedAt: string; status: "in_progress" | "submitted"; pct: number | null; sections: { title: string; pct: number }[] | null }[];
}

export default function MockTests() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<MocksResponse>("/student/mocks");
  const [busy, setBusy] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const open = data.attempts.find((a) => a.status === "in_progress");
  const nameOf = (id: string) => data.patterns.find((p) => p.id === id)?.name ?? id;

  async function start(pattern: string) {
    setBusy(pattern);
    setStartError(null);
    try {
      const view = await api<{ id: string }>("/student/mocks", { body: { pattern } });
      router.push(`/play/mocks/${view.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "mock_in_progress") router.push(`/play/mocks/${(e.details as { id: string }).id}`);
      else setStartError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: 0 }}>{t("Mock tests")}</h1>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          {t("A full test on the pattern companies use: sections in order, each with its own timer. You can't go back to a section once it closes, and the clock keeps running if you leave.")}
        </p>
      </div>

      {open && (
        <Link href={`/play/mocks/${open.id}`} className="card spread" style={{ color: "inherit", borderColor: "var(--accent)" }}>
          <div>
            <b>{t("Resume your mock test")}</b>
            <div className="small muted">{t(nameOf(open.pattern))}</div>
          </div>
          <Icon name="arrow" />
        </Link>
      )}

      {startError && <ErrorBox message={startError} />}
      {data.patterns.map((p) => (
        <section key={p.id} className="card stack" aria-labelledby={`mock-${p.id}`}>
          <div className="spread wrap" style={{ alignItems: "flex-start" }}>
            <div>
              <h2 id={`mock-${p.id}`} style={{ margin: 0 }}>
                {t(p.name)}
              </h2>
              <div className="small muted">{t(p.description)}</div>
            </div>
            <span className="pill">{t("{n} minutes", { n: p.minutes })}</span>
          </div>
          <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {p.sections.map((s) => (
              <li key={s.title}>
                {t(s.title)} · {s.kind === "coding" ? t("{n} coding problems", { n: s.count }) : t("{n} questions", { n: s.count })} · {t("{n} min", { n: s.minutes })}
              </li>
            ))}
          </ol>
          <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy !== null || Boolean(open)} onClick={() => start(p.id)}>
            {busy === p.id ? t("Preparing your paper...") : t("Start")}
          </button>
        </section>
      ))}

      {data.attempts.some((a) => a.status === "submitted") && (
        <section className="card stack" aria-labelledby="mock-history">
          <h2 id="mock-history" style={{ margin: 0 }}>
            {t("Your results")}
          </h2>
          {data.attempts
            .filter((a) => a.status === "submitted")
            .map((a) => (
              <Link key={a.id} href={`/play/mocks/${a.id}`} className="stack" style={{ color: "inherit", gap: 4 }}>
                <div className="spread small">
                  <span>
                    <b>{t(nameOf(a.pattern))}</b> · {new Date(a.startedAt).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" })}
                  </span>
                  <span>{a.pct}%</span>
                </div>
                <Bar value={a.pct ?? 0} tone={masteryTone(a.pct ?? 0)} label={t("Score")} />
              </Link>
            ))}
        </section>
      )}
    </div>
  );
}
