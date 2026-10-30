"use client";

import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

interface Mine {
  doubts: { id: string; stem: string; text: string; status: "open" | "answered" | "closed"; answer: string | null; createdAt: string; answeredAt: string | null }[];
}

export default function MyDoubts() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload } = useApi<Mine>("/student/doubts");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const date = (iso: string) => new Date(iso).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short" });
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("My doubts")}</h1>
      {data.doubts.length === 0 ? (
        <div className="card muted">{t("No doubts yet. After answering a question, tap \"Still confused? Ask your teachers\".")}</div>
      ) : (
        data.doubts.map((d) => (
          <article key={d.id} className="card stack" style={{ gap: 6 }}>
            <div className="spread small">
              <span className="muted">{date(d.createdAt)}</span>
              <span className={`pill ${d.status === "answered" ? "good" : d.status === "open" ? "warn" : ""}`}>
                {t(d.status === "answered" ? "Answered" : d.status === "open" ? "Waiting" : "Closed")}
              </span>
            </div>
            <div className="small" style={{ whiteSpace: "pre-line", fontWeight: 600 }}>
              {d.stem}
            </div>
            <div className="small muted">
              {t("You asked:")} {d.text}
            </div>
            {d.answer && <div style={{ whiteSpace: "pre-line" }}>{d.answer}</div>}
          </article>
        ))
      )}
    </div>
  );
}
