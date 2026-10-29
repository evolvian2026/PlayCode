"use client";

import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

interface Circular {
  id: string;
  title: string;
  body: string;
  requireAck: boolean;
  ackBy: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
}
interface Mine {
  circulars: Circular[];
  pending: number;
}

export default function CircularsPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload, setData } = useApi<Mine>("/student/circulars");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const fmt = (d: string | Date) => new Date(d).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" });

  async function ack(id: string) {
    setBusy(id);
    setMsg(null);
    try {
      setData(await api<Mine>(`/student/circulars/${id}/ack`, { body: {} }));
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: 0 }}>{t("Circulars")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Notices from your placement cell and teachers.")}
        </p>
      </div>
      {msg && <ErrorBox message={msg} />}
      {data.circulars.length === 0 ? (
        <div className="card muted">{t("No circulars yet.")}</div>
      ) : (
        data.circulars.map((c) => {
          const pending = c.requireAck && !c.acknowledgedAt;
          return (
            <article key={c.id} className="card stack" style={{ gap: 8, borderColor: pending ? "var(--warn)" : undefined }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.125rem" }}>{c.title}</h2>
                <div className="small muted">{fmt(c.createdAt)}</div>
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
              {c.requireAck &&
                (c.acknowledgedAt ? (
                  <span className="pill good" style={{ alignSelf: "flex-start" }}>
                    {t("Acknowledged on {date}", { date: fmt(c.acknowledgedAt) })}
                  </span>
                ) : (
                  <div className="row wrap">
                    <button className="btn primary small" disabled={busy === c.id} onClick={() => ack(c.id)}>
                      {t("I've read this")}
                    </button>
                    {c.ackBy && <span className="small muted">{t("Please acknowledge by {date}", { date: fmt(`${c.ackBy}T12:00:00`) })}</span>}
                  </div>
                ))}
            </article>
          );
        })
      )}
    </div>
  );
}
