"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { ContestState } from "@playcode/core";
import { useMe } from "@/components/Auth";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { STATE_LABEL, type BoardRow } from "@/lib/contests";

interface StaffView {
  id: string;
  title: string;
  description: string;
  byPlayCode: boolean;
  state: ContestState;
  startsAt: string;
  endsAt: string;
  freezeMinutes: number;
  problems: { letter: string; id: string; stem: string; solvedBy: number; submissions: number }[];
  scoreboard: (BoardRow & { userId: string | null })[];
}

interface Pair {
  letter: string;
  a: { name: string; rollNo: string | null };
  b: { name: string; rollNo: string | null };
  similarityPct: number;
}

function Similarity({ id }: { id: string }) {
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    setError(null);
    try {
      setPairs((await api<{ pairs: Pair[] }>(`/console/contests/${id}/similarity`)).pairs);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card stack">
      <div className="spread wrap">
        <h2 style={{ margin: 0 }}>Copied code</h2>
        <button className="btn small" disabled={busy} onClick={check}>
          {busy ? "Checking..." : pairs ? "Check again" : "Check accepted solutions"}
        </button>
      </div>
      {error && <ErrorBox message={error} />}
      {pairs &&
        (pairs.length === 0 ? (
          <div className="small muted">No pairs of accepted solutions are 85% or more alike.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Problem</th>
                  <th>Student</th>
                  <th>Student</th>
                  <th>Alike</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p, i) => (
                  <tr key={i}>
                    <td>{p.letter}</td>
                    <td>
                      {p.a.name} <span className="small muted">{p.a.rollNo}</span>
                    </td>
                    <td>
                      {p.b.name} <span className="small muted">{p.b.rollNo}</span>
                    </td>
                    <td>
                      <span className="pill bad">{p.similarityPct}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <div className="small muted">Compares each student&apos;s last accepted solution to every problem, after the contest ends. A high match is a reason to talk to the students, not proof.</div>
    </div>
  );
}

export default function ContestDetail() {
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<StaffView>(`/console/contests/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <Link href="/console/contests" className="small muted">
          Coding contests
        </Link>
        <div className="spread wrap">
          <h1 style={{ margin: 0 }}>{data.title}</h1>
          <div className="row">
            <span className={`pill ${data.state === "live" || data.state === "frozen" ? "good" : ""}`}>{STATE_LABEL[data.state]}</span>
            <button className="btn small" onClick={() => void reload()}>
              Refresh
            </button>
          </div>
        </div>
        <div className="small muted">
          {when(data.startsAt)} - {when(data.endsAt)}
          {data.freezeMinutes ? ` · students' scoreboard freezes for the last ${data.freezeMinutes} minutes (you always see it live)` : ""}
          {data.byPlayCode ? " · run by PlayCode across colleges" : ""}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {data.problems.map((p) => (
          <div key={p.id} className="card tight">
            <b>{p.letter}.</b> <span className="small">{p.stem}</span>
            <div className="small muted">
              solved by {p.solvedBy} · {p.submissions} submissions
            </div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Solved</th>
                <th>Penalty</th>
                {data.problems.map((p) => (
                  <th key={p.id}>{p.letter}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.scoreboard.length === 0 && (
                <tr>
                  <td colSpan={4 + data.problems.length} className="muted">
                    No submissions yet.
                  </td>
                </tr>
              )}
              {data.scoreboard.map((r, i) => (
                <tr key={i}>
                  <td>{r.rank}</td>
                  <td>
                    {r.userId ? <Link href={`/console/students/${r.userId}`}>{r.name}</Link> : r.name}
                    <div className="small muted">{[r.rollNo, r.college].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td>{r.solved}</td>
                  <td>{r.penalty}</td>
                  {data.problems.map((p) => {
                    const c = r.problems[p.id];
                    return (
                      <td key={p.id} className="small" style={{ color: c?.solvedAtMin != null ? "var(--good-ink)" : c?.tries ? "var(--bad-ink)" : undefined }}>
                        {!c ? "" : c.solvedAtMin != null ? `+${c.tries > 1 ? c.tries - 1 : ""} (${c.solvedAtMin}')` : c.tries ? `-${c.tries}` : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {data.state === "ended" && me.permissions.includes("events.manage") && <Similarity id={data.id} />}
    </div>
  );
}
