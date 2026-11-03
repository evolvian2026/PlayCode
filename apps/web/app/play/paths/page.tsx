"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { startAndOpen } from "@/lib/start";
import type { StudentPath, StudentPathStep } from "@/lib/types";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

const due = (s: StudentPathStep, locale: string) => (s.dueAt ? new Date(s.dueAt).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short" }) : null);

function StepRow({ step, onStart, busy }: { step: StudentPathStep; onStart: () => void; busy: boolean }) {
  const t = useT();
  const locale = useLocale();
  const goal = t(step.kind === "skill" ? "Reach {n}% mastery" : "Score {n}% or more", { n: step.target });
  const progress = step.value === null ? t("not started") : t(step.kind === "skill" ? "{n}% now" : "best {n}%", { n: step.value });
  const date = due(step, locale);
  return (
    <div className="row" style={{ alignItems: "flex-start", color: step.state === "locked" ? "var(--muted)" : undefined }}>
      <span className={`path-dot ${step.state}`} aria-hidden>
        {step.state === "done" ? <Icon name="check" size={14} /> : null}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{step.title}</div>
        <div className="small muted">
          {step.kind === "pack" ? t("Mission · ") : ""}
          {goal} · {progress}
          {date && (
            <span style={{ color: step.overdue ? "var(--bad-ink)" : undefined }}>
              {" "}
              · {t(step.overdue ? "was due {date}" : "due {date}", { date })}
            </span>
          )}
        </div>
      </div>
      {(step.state === "current" || step.state === "open") && (
        <button className="btn primary small" disabled={busy} onClick={onStart}>
          {t(step.value === null ? "Start" : "Practise")}
        </button>
      )}
      {step.state === "locked" && <span className="small muted">{t("Locked")}</span>}
    </div>
  );
}

export default function Paths() {
  const t = useT();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ paths: StudentPath[] }>("/student/paths");
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function start(step: StudentPathStep) {
    setBusy(true);
    setStartError(await startAndOpen(step.kind === "skill" ? { kind: "skill", skillId: step.ref } : { kind: "pack", packId: step.ref }, router.push));
    setBusy(false);
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  return (
    <div className="stack">
      <h1>{t("Learning paths")}</h1>
      {startError && <ErrorBox message={startError} />}
      {data.paths.length === 0 && <div className="card muted">{t("No learning paths yet. Your teachers or managers set them up.")}</div>}
      {data.paths.map((p) => (
        <div key={p.id} className="card stack">
          <div className="spread">
            <h2 style={{ margin: 0 }}>{p.title}</h2>
            <span className="small muted">
              {p.done}/{p.steps.length}
            </span>
          </div>
          {p.description && <p className="small muted" style={{ margin: 0 }}>{p.description}</p>}
          <Bar value={(p.done / p.steps.length) * 100} tone="good" />
          {p.certificate && (
            <Link className="pill good" href={`/verify/${p.certificate}`} style={{ alignSelf: "flex-start" }}>
              <Icon name="award" size={14} /> {t("Completed: view certificate")}
            </Link>
          )}
          <div className="stack" style={{ gap: 12 }}>
            {p.steps.map((s) => (
              <StepRow key={s.id} step={s} busy={busy} onStart={() => start(s)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
