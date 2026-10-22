"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { startAndOpen } from "@/lib/start";

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
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ missions: Mission[] }>("/student/missions");
  const [startError, setStartError] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  return (
    <div className="stack">
      <div>
        <h1>Missions</h1>
        <p className="muted">Company-style rounds. Clear the pass mark to earn the Mission Ready badge. No hearts needed.</p>
      </div>
      {startError && <ErrorBox message={startError} />}
      {data.missions.map((m) => (
        <div key={m.id} className="card stack">
          <div className="spread">
            <h2 style={{ margin: 0 }}>{m.title}</h2>
            {m.passed ? <span className="pill good">Passed</span> : m.bestScore !== null ? <span className="pill warn">Best {m.bestScore}%</span> : null}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {m.description}
          </p>
          <div className="spread">
            <span className="small muted">
              {m.questionCount} questions · pass mark {m.passMark}%{m.attempts ? ` · ${m.attempts} attempt${m.attempts > 1 ? "s" : ""}` : ""}
            </span>
            <button
              className="btn primary small"
              onClick={async () =>
                m.inProgressSessionId ? router.push(`/play/session/${m.inProgressSessionId}`) : setStartError(await startAndOpen({ kind: "pack", packId: m.id }, router.push))
              }
            >
              {m.inProgressSessionId ? "Continue" : m.attempts ? "Retry" : "Start"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
