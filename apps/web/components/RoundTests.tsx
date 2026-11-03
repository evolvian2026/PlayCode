"use client";

import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

type Result = "pass" | "fail" | "review" | "not_taken" | "in_progress" | "not_invited";
interface Round {
  round: number;
  roundName: string;
  cutoffPct: number;
  appliedAt: string | null;
  test: { id: string; title: string; openAt: string; closeAt: string; closed: boolean };
  counts: Record<Result, number>;
  students: { userId: string; name: string; rollNo: string | null; result: Result; pct: number | null; riskScore: number | null }[];
}

const RESULT: Record<Result, [string, string]> = {
  pass: ["Clears the cut-off", "good"],
  fail: ["Below the cut-off", "bad"],
  review: ["Flagged by proctoring: look first", "warn"],
  not_taken: ["Didn't take it", ""],
  in_progress: ["Still taking it", "accent"],
  not_invited: ["Not invited to the test", "warn"],
};
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Drive rounds taken as PlayCode tests: link a test with a cut-off, see where everyone stands, and move them on in one step. */
export function RoundTests({ driveId, rounds, onApplied }: { driveId: string; rounds: string[]; onApplied: () => void }) {
  const { data, error, loading, reload, setData } = useApi<{ rounds: Round[] }>(`/console/placements/${driveId}/round-tests`);
  const tests = useApi<{ assessments: { id: string; title: string; openAt: string; closeAt: string; state: string }[] }>("/console/assessments");
  const [adding, setAdding] = useState(false);
  const [round, setRound] = useState(0);
  const [assessmentId, setAssessmentId] = useState("");
  const [cutoff, setCutoff] = useState(60);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(method: "PUT" | "DELETE" | "POST", path: string, body?: object, done?: (r: { rounds: Round[]; cleared?: number; notSelected?: number }) => void) {
    setBusy(true);
    setMsg(null);
    setNotice(null);
    try {
      const r = await api<{ rounds: Round[]; cleared?: number; notSelected?: number }>(`/console/placements/${driveId}/round-tests/${path}`, { method, body });
      setData({ rounds: r.rounds });
      done?.(r);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="spread wrap">
        <div>
          <h2 style={{ margin: 0 }}>Online tests on PlayCode</h2>
          <div className="small muted">Run a round as one of your PlayCode tests. Once it closes, everyone at or above the cut-off clears the round in one step.</div>
        </div>
        {!adding && (
          <button className="btn small" onClick={() => setAdding(true)}>
            Link a test
          </button>
        )}
      </div>
      {adding && (
        <div className="row wrap" style={{ alignItems: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <div>
            <label htmlFor="rt-round">Round</label>
            <select id="rt-round" value={round} onChange={(e) => setRound(Number(e.target.value))}>
              {rounds.map((r, i) => (
                <option key={r} value={i}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rt-test">Test</label>
            <select id="rt-test" value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
              <option value="">Choose a test</option>
              {(tests.data?.assessments ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} ({a.state})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rt-cut">Cut-off %</label>
            <input id="rt-cut" type="number" min={1} max={100} value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))} style={{ maxWidth: 100 }} />
          </div>
          <button
            className="btn primary small"
            disabled={busy || !assessmentId}
            onClick={() => call("PUT", String(round), { assessmentId, cutoffPct: cutoff }, () => setAdding(false))}
          >
            Link
          </button>
          <button className="btn ghost small" onClick={() => setAdding(false)}>
            Cancel
          </button>
          <div className="small muted" style={{ flexBasis: "100%" }}>
            Make the test open to the drive&apos;s batches under Tests. Students waiting for this round see it on their drive card.
          </div>
        </div>
      )}
      {msg && <ErrorBox message={msg} />}
      {notice && (
        <div className="small" role="status" style={{ color: "var(--good-ink)" }}>
          ✓ {notice}
        </div>
      )}
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.rounds.length ? (
        !adding && <div className="small muted">No round is linked to a test.</div>
      ) : (
        data.rounds.map((r) => (
          <section key={r.round} className="stack" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }} aria-label={`${r.roundName} test`}>
            <div className="spread wrap" style={{ gap: 8 }}>
              <div>
                <b>
                  {r.roundName}: {r.test.title}
                </b>
                <div className="small muted">
                  Cut-off {r.cutoffPct}% · {r.test.closed ? "closed" : `open ${when(r.test.openAt)} to ${when(r.test.closeAt)}`}
                  {r.appliedAt ? ` · results applied ${when(r.appliedAt)}` : ""}
                </div>
              </div>
              <div className="row">
                <button
                  className="btn primary small"
                  disabled={busy || !r.test.closed || (!r.counts.pass && !r.counts.fail)}
                  title={r.test.closed ? undefined : "Available once the test closes"}
                  onClick={() =>
                    window.confirm(`${r.counts.pass} students clear ${r.roundName} and ${r.counts.fail} are marked not selected. Go ahead?`) &&
                    call("POST", `${r.round}/apply`, {}, (res) => {
                      setNotice(`${res.cleared} cleared the round, ${res.notSelected} not selected. Students held back or who didn't take the test are still listed.`);
                      onApplied();
                    })
                  }
                >
                  Apply results
                </button>
                <button className="btn ghost small" disabled={busy} onClick={() => call("DELETE", String(r.round))}>
                  Unlink
                </button>
              </div>
            </div>
            <div className="row wrap small" style={{ gap: 6 }}>
              {(Object.keys(RESULT) as Result[])
                .filter((k) => r.counts[k])
                .map((k) => (
                  <span key={k} className={`pill ${RESULT[k][1]}`}>
                    {RESULT[k][0]}: {r.counts[k]}
                  </span>
                ))}
            </div>
            {r.students.length > 0 && (
              <div className="table-wrap">
                <table className="small">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Score</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.students.map((s) => (
                      <tr key={s.userId}>
                        <td>
                          {s.name} <span className="muted">{s.rollNo}</span>
                        </td>
                        <td>{s.pct === null ? "-" : `${s.pct}%`}</td>
                        <td>
                          <span className={`pill ${RESULT[s.result][1]}`}>{RESULT[s.result][0]}</span>
                          {s.riskScore !== null && s.riskScore >= 40 ? <span className="muted"> · risk {s.riskScore}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
