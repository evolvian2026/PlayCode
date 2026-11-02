"use client";

import Link from "next/link";
import { useState } from "react";
import { DRIVE_PREP_STEPS, type DrivePrepStep } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Prep {
  steps: { key: DrivePrepStep; label: string; done: number; applies: number }[];
  students: { id: string; name: string; rollNo: string | null; steps: Record<DrivePrepStep, boolean | null>; done: number; total: number; missing: DrivePrepStep[] }[];
  ready: number;
}

/** How the registrants are getting ready for a drive, step by step, with a reminder for those behind. */
export function DrivePrep({ driveId }: { driveId: string }) {
  const { data, error, loading, reload } = useApi<Prep>(`/console/placements/${driveId}/prep`);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data || !data.students.length) return null;
  const behind = data.students.filter((s) => s.missing.length).length;
  async function remind() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ sent: number }>(`/console/placements/${driveId}/prep/remind`, { body: {} });
      setMsg(r.sent ? `Reminded ${r.sent} ${r.sent === 1 ? "student" : "students"}, each with what they're missing.` : "Everyone behind has already been reminded today.");
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-labelledby="h-prep">
      <div className="spread wrap" style={{ gap: 8 }}>
        <div>
          <h2 id="h-prep" style={{ margin: 0 }}>
            Getting ready
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            {data.ready} of {data.students.length} registered students have done every step. Students see the same plan on their drive card.
          </p>
        </div>
        {behind > 0 && (
          <button className="btn small" disabled={busy} onClick={remind}>
            Remind the {behind} behind
          </button>
        )}
      </div>
      {msg && <div className="small" role="status">{msg}</div>}
      <div className="table-wrap">
        <table className="small">
          <caption className="sr-only">Each registered student against the drive's preparation steps, those furthest behind first</caption>
          <thead>
            <tr>
              <th scope="col">Student</th>
              {data.steps.map((s) => (
                <th key={s.key} scope="col" title={DRIVE_PREP_STEPS[s.key].detail}>
                  {s.label}
                  <div style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
                    {s.done} of {s.applies}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.students.map((st) => (
              <tr key={st.id}>
                <td>
                  <Link href={`/console/students/${st.id}`}>{st.name}</Link>
                  <div className="muted">
                    {st.rollNo} · {st.done}/{st.total}
                  </div>
                </td>
                {data.steps.map((s) => (
                  <td key={s.key} style={{ color: st.steps[s.key] ? "var(--good-ink)" : st.steps[s.key] === false ? "var(--bad-ink)" : "var(--muted)" }}>
                    <span aria-hidden="true">{st.steps[s.key] === null ? "-" : st.steps[s.key] ? "✓" : "✗"}</span>
                    <span className="sr-only">{st.steps[s.key] === null ? "Doesn't apply" : st.steps[s.key] ? "Done" : "Not yet"}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
