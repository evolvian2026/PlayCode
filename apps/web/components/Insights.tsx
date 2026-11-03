"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Insights {
  available: boolean;
  reason: string | null;
  scope: string;
  generatedAt: string | null;
  report: { headline: string; points: { text: string; tone: "good" | "watch" | "act" }[]; actions: string[] } | null;
}

const TONE: Record<"good" | "watch" | "act", { label: string; pill: string }> = {
  good: { label: "Going well", pill: "good" },
  watch: { label: "Watch", pill: "warn" },
  act: { label: "Act", pill: "bad" },
};

/** "This week": an AI-written briefing from the overview's aggregates, once a day per scope. */
export function InsightsCard({ unitId }: { unitId: string }) {
  const q = unitId ? `?unitId=${unitId}` : "";
  const { data, setData } = useApi<Insights>(`/console/insights${q}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data || (!data.available && !data.report)) return null;

  async function write() {
    setBusy(true);
    setError(null);
    try {
      setData(await api<Insights>("/console/insights", { body: unitId ? { unitId } : {} }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="spread wrap">
        <h2 style={{ margin: 0 }}>This week</h2>
        <span className="small muted">
          {data.scope}
          {data.generatedAt ? ` · written ${new Date(data.generatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : ""}
        </span>
      </div>
      {!data.report ? (
        <div className="spread wrap">
          <p className="small muted" style={{ margin: 0 }}>
            A short briefing on this week&apos;s activity, readiness, weak skills and assignments, with suggested actions. Written by AI from these figures only; no student names are shared.
          </p>
          <button className="btn primary" disabled={busy} onClick={write}>
            {busy ? "Writing..." : "Write this week's briefing"}
          </button>
        </div>
      ) : (
        <>
          <p style={{ margin: 0, fontWeight: 600 }}>{data.report.headline}</p>
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
            {data.report.points.map((p, i) => (
              <li key={i} className="row small" style={{ alignItems: "flex-start", gap: 8 }}>
                <span className={`pill ${TONE[p.tone].pill}`} style={{ flexShrink: 0 }}>
                  {TONE[p.tone].label}
                </span>
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
          <div>
            <b className="small">Suggested this week</b>
            <ol className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {data.report.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </div>
          <div className="small muted">Written by AI from the figures on this page; check before acting. A new briefing can be written tomorrow.</div>
        </>
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}
