"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { startAndOpen } from "@/lib/start";
import type { StudentPath, StudentPathStep } from "@/lib/types";

const due = (s: StudentPathStep) => (s.dueAt ? new Date(s.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);

function StepRow({ step, onStart, busy }: { step: StudentPathStep; onStart: () => void; busy: boolean }) {
  const goal = step.kind === "skill" ? `Reach ${step.target}% mastery` : `Score ${step.target}% or more`;
  const progress = step.value === null ? "not started" : step.kind === "skill" ? `${step.value}% now` : `best ${step.value}%`;
  return (
    <div className="row" style={{ alignItems: "flex-start", opacity: step.state === "locked" ? 0.55 : 1 }}>
      <span className={`path-dot ${step.state}`} aria-hidden>
        {step.state === "done" ? <Icon name="check" size={14} /> : null}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{step.title}</div>
        <div className="small muted">
          {step.kind === "pack" ? "Mission · " : ""}
          {goal} · {progress}
          {due(step) && (
            <span style={{ color: step.overdue ? "var(--bad)" : undefined }}>
              {" "}
              · {step.overdue ? "was due" : "due"} {due(step)}
            </span>
          )}
        </div>
      </div>
      {(step.state === "current" || step.state === "open") && (
        <button className="btn primary small" disabled={busy} onClick={onStart}>
          {step.value === null ? "Start" : "Practise"}
        </button>
      )}
      {step.state === "locked" && <span className="small muted">Locked</span>}
    </div>
  );
}

export default function Paths() {
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
      <h1>Learning paths</h1>
      {startError && <ErrorBox message={startError} />}
      {data.paths.length === 0 && <div className="card muted">No learning paths yet. Your teachers or managers set them up.</div>}
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
              <Icon name="award" size={14} /> Completed: view certificate
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
