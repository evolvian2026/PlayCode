"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { startAndOpen } from "@/lib/start";
import { useT } from "@/lib/i18n";

interface Mission {
  id: string;
  title: string;
  description: string;
  questionCount: number;
  passMark: number;
  profile: string | null;
  bestScore: number | null;
  passed: boolean;
  attempts: number;
  inProgressSessionId: string | null;
}

export default function Missions() {
  const t = useT();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ missions: Mission[] }>("/student/missions");
  const [startError, setStartError] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;

  return (
    <div className="stack">
      <div>
        <h1>{t("Missions")}</h1>
        <p className="muted">{t("Company-style rounds. Clear the pass mark to earn the Mission Ready badge. No hearts needed.")}</p>
      </div>
      {startError && <ErrorBox message={startError} />}
      {data.missions.map((m) => (
        <div key={m.id} className="card stack">
          <div className="spread">
            <h2 style={{ margin: 0 }}>{m.title}</h2>
            {m.passed ? <span className="pill good">{t("Passed")}</span> : m.bestScore !== null ? <span className="pill warn">{t("Best {n}%", { n: m.bestScore })}</span> : null}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {m.description}
          </p>
          <div className="spread">
            <span className="small muted">
              {t("{n} questions · pass mark {pass}%", { n: m.questionCount, pass: m.passMark })}
              {m.attempts ? ` · ${t(m.attempts > 1 ? "{n} attempts" : "{n} attempt", { n: m.attempts })}` : ""}
            </span>
            <button
              className="btn primary small"
              onClick={async () =>
                m.inProgressSessionId ? router.push(`/play/session/${m.inProgressSessionId}`) : setStartError(await startAndOpen({ kind: "pack", packId: m.id }, router.push))
              }
            >
              {t(m.inProgressSessionId ? "Continue" : m.attempts ? "Retry" : "Start")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
