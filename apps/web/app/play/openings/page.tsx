"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { OpeningKind, OpeningResponse } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

interface Opening {
  id: string;
  kind: OpeningKind;
  kindLabel: string;
  company: string;
  roleTitle: string;
  pay: string | null;
  location: string;
  details: string;
  applyUrl: string | null;
  closesOn: string;
  state: "open" | "closing" | "closed";
  response: OpeningResponse | null;
}

function Card({ o, highlight, onChange }: { o: Opening; highlight: boolean; onChange: (list: Opening[]) => void }) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const by = new Date(`${o.closesOn}T00:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" });
  async function answer(response: OpeningResponse | null) {
    setBusy(true);
    setError(null);
    try {
      onChange((await api<{ openings: Opening[] }>(`/student/openings/${o.id}`, { method: "PUT", body: { response } })).openings);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div id={`o-${o.id}`} className="card stack" style={{ gap: 8, borderColor: highlight ? "var(--accent)" : undefined }}>
      <div className="spread" style={{ alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.125rem" }}>{o.company}</div>
          <div className="small">{o.roleTitle}</div>
          <div className="small muted">{[o.pay, o.location].filter(Boolean).join(" · ")}</div>
        </div>
        <span className="pill accent">{t(o.kindLabel)}</span>
      </div>
      {o.details && <div className="small" style={{ whiteSpace: "pre-wrap" }}>{o.details}</div>}
      <div className="small" style={{ fontWeight: o.state === "closing" ? 600 : 400, color: o.state === "closing" ? "var(--bad-ink)" : undefined }}>
        {o.state === "closed" ? t("Closed") : t("Apply by {date}", { date: by })}
      </div>
      {o.response === "applied" ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="pill good">{t("You applied")}</span>
          {o.state !== "closed" && (
            <button className="btn ghost small" disabled={busy} onClick={() => answer(null)}>
              {t("Undo")}
            </button>
          )}
        </div>
      ) : o.response === "not_interested" ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="pill">{t("Not for you")}</span>
          {o.state !== "closed" && (
            <button className="btn ghost small" disabled={busy} onClick={() => answer(null)}>
              {t("Undo")}
            </button>
          )}
        </div>
      ) : (
        o.state !== "closed" && (
          <div className="row wrap" style={{ gap: 6 }}>
            {o.applyUrl && (
              <a className="btn primary small" href={o.applyUrl} target="_blank" rel="noreferrer">
                {t("Apply on their site")}
              </a>
            )}
            <button className="btn small" disabled={busy} onClick={() => answer("applied")}>
              {t("I applied")}
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => answer("not_interested")}>
              {t("Not for me")}
            </button>
          </div>
        )
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}

function Openings() {
  const t = useT();
  const id = useSearchParams().get("id");
  const { data, error, loading, reload, setData } = useApi<{ openings: Opening[] }>("/student/openings");
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  const list = data?.openings ?? [];
  const set = (openings: Opening[]) => setData({ openings });
  const open = list.filter((o) => o.state !== "closed");
  const past = list.filter((o) => o.state === "closed");
  return (
    <div className="stack">
      <div>
        <Link href="/play/placements" className="small muted">
          ← {t("Placements")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{t("Openings off campus")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Openings your placement cell found outside campus drives, that you are eligible for. You apply with the company; tell your placement cell when you have, so they can help.")}
        </p>
      </div>
      {open.length === 0 ? <div className="card muted">{t("Nothing open for you right now. You'll get a notification when something comes up.")}</div> : open.map((o) => <Card key={o.id} o={o} highlight={o.id === id} onChange={set} />)}
      {past.length > 0 && (
        <>
          <h2 style={{ margin: "8px 0 0" }}>{t("Closed")}</h2>
          {past.map((o) => (
            <Card key={o.id} o={o} highlight={false} onChange={set} />
          ))}
        </>
      )}
    </div>
  );
}

export default function OpeningsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Openings />
    </Suspense>
  );
}
