"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bar, ErrorBox, Loading, masteryTone } from "@/components/ui";
import { useApi } from "@/lib/api";
import { usePlayer } from "@/lib/player-state";
import { startAndOpen } from "@/lib/start";
import { useT } from "@/lib/i18n";

interface MapData {
  topics: { topic: string; name: string; mastery: number; skills: { id: string; name: string; mastery: number; attempts: number; questionCount: number; reviewDue: boolean }[] }[];
}

export default function Learn() {
  const t = useT();
  const router = useRouter();
  const { profile } = usePlayer();
  const { data, error, loading, reload } = useApi<MapData>("/student/map");
  const [startError, setStartError] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const outOfHearts = profile?.hearts === 0;

  return (
    <div className="stack">
      <div>
        <h1>{t("Learn")}</h1>
        <p className="muted">{t("Each practice set has 8 questions. A wrong answer costs a heart.")}</p>
      </div>
      {outOfHearts && (
        <div className="card" style={{ background: "var(--bad-soft)", borderColor: "transparent" }}>
          {t("You are out of hearts. Review a mistake from the Home tab to earn one back, or wait for a refill.")}
        </div>
      )}
      {startError && <ErrorBox message={startError} />}
      {data.topics.map((topic) => (
        <section key={topic.topic} className="card stack">
          <div className="spread">
            <h2 style={{ margin: 0 }}>{topic.name}</h2>
            <span className="pill accent">{t("{n}% mastery", { n: topic.mastery })}</span>
          </div>
          {topic.skills.map((s) => (
            <div key={s.id} className="spread">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="spread small">
                  <span style={{ fontWeight: 600 }}>
                    {s.name}
                    {s.reviewDue && <span className="pill warn" style={{ marginLeft: 6 }}>{t("fading")}</span>}
                  </span>
                  <span className="muted">{s.attempts ? `${s.mastery}%` : t("new")}</span>
                </div>
                <Bar value={s.mastery} tone={masteryTone(s.mastery)} />
              </div>
              <button
                className="btn small primary"
                disabled={outOfHearts || s.questionCount === 0}
                onClick={async () => setStartError(await startAndOpen({ kind: "skill", skillId: s.id }, router.push))}
              >
                {t("Play")}
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
