"use client";

import { useState } from "react";
import { useMe } from "@/components/Auth";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

interface Student {
  id: string;
  name: string;
  rollNo: string | null;
  unit: string | null;
}
interface Pending {
  id: string;
  ref: string;
  date: string;
  partLabel: string;
  reason: "drive" | "opening" | "other";
  purpose: string;
  detail: string;
  student: Student;
  evidence: {
    registered?: boolean;
    applicationStatus?: string | null;
    roundsCleared?: number;
    reportedAtDesk?: boolean;
    applied?: boolean;
  } | null;
}
interface Roster {
  from: string;
  to: string;
  entries: {
    id: string;
    ref: string;
    date: string;
    partLabel: string;
    purpose: string;
    student: Student;
  }[];
}

const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const who = (s: Student) => `${s.name}${s.rollNo ? ` (${s.rollNo})` : ""}`;

function evidence(r: Pending): [string, string][] {
  const e = r.evidence;
  if (!e) return [["Not linked to a drive: check with the student", "warn"]];
  if (e.applied) return [["Said they applied", ""]];
  const out: [string, string][] = [
    e.registered ? ["Registered", "good"] : ["Not registered", "bad"],
  ];
  if (e.applicationStatus === "rejected")
    out.push([`Out after round ${(e.roundsCleared ?? 0) + 1}`, "warn"]);
  if (e.applicationStatus === "shortlisted") out.push(["Shortlisted", "good"]);
  if (e.applicationStatus === "offered") out.push(["Offered", "good"]);
  if (e.reportedAtDesk) out.push(["Reported at the desk", "good"]);
  return out;
}

function Row({ r, onDone }: { r: Pending; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function decide(approve: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await api("/console/on-duty/decide", {
        body: { ids: [r.id], approve, note: approve ? null : note },
      });
      onDone();
    } catch (e) {
      setMsg(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <div
      className="stack"
      style={{ gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }}
    >
      <div className="spread wrap" style={{ gap: 8 }}>
        <div>
          <b>{who(r.student)}</b>{" "}
          <span className="small muted">{r.student.unit}</span>
          <div className="small">
            {day(r.date)}, {r.partLabel.toLowerCase()}
            {r.detail ? ` · ${r.detail}` : ""}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 4 }}>
          {evidence(r).map(([label, tone]) => (
            <span key={label} className={`pill ${tone}`}>
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <button
          className="btn primary small"
          disabled={busy}
          onClick={() => decide(true)}
        >
          Approve
        </button>
        <input
          aria-label={`Why not, for ${r.student.name}`}
          placeholder="Why not, to decline"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          style={{ maxWidth: 300 }}
        />
        <button
          className="btn small"
          disabled={busy || !note.trim()}
          onClick={() => decide(false)}
        >
          Decline
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

function Queue({ onDecided }: { onDecided: () => void }) {
  const { data, error, loading, reload } = useApi<{ requests: Pending[] }>(
    "/console/on-duty/queue",
  );
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const done = () => {
    reload();
    onDecided();
  };
  // One group per drive or purpose, so a drive's students are approved together.
  const groups = new Map<string, Pending[]>();
  for (const r of data.requests)
    (groups.get(r.purpose) ?? groups.set(r.purpose, []).get(r.purpose)!).push(
      r,
    );
  async function approveAll(ids: string[]) {
    setMsg(null);
    try {
      await api("/console/on-duty/decide", { body: { ids, approve: true } });
      done();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <section className="stack" aria-labelledby="h-approve" style={{ gap: 12 }}>
      <h2 id="h-approve" style={{ margin: 0 }}>
        To approve{" "}
        {data.requests.length > 0 && (
          <span className="pill warn">{data.requests.length}</span>
        )}
      </h2>
      {msg && <ErrorBox message={msg} />}
      {data.requests.length === 0 && (
        <div className="card muted">
          Nothing waiting. Students who reported at a drive desk are approved
          without waiting.
        </div>
      )}
      {[...groups.entries()].map(([purpose, rows]) => (
        <article key={purpose} className="card stack" style={{ gap: 6 }}>
          <div className="spread wrap" style={{ gap: 8 }}>
            <b>{purpose}</b>
            {rows.length > 1 && (
              <button
                className="btn small"
                onClick={() => approveAll(rows.map((r) => r.id))}
              >
                Approve all {rows.length}
              </button>
            )}
          </div>
          {rows.map((r) => (
            <Row key={r.id} r={r} onDone={done} />
          ))}
        </article>
      ))}
    </section>
  );
}

function RosterView({ version }: { version: number }) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const qs = range ? `?from=${range.from}&to=${range.to}` : "";
  const { data, error, loading, reload } = useApi<Roster>(
    `/console/on-duty${qs}${qs ? "&" : "?"}v=${version}`,
  );
  const [msg, setMsg] = useState<string | null>(null);
  async function csv() {
    if (!data) return;
    setMsg(null);
    try {
      const a = document.createElement("a");
      a.href = await fetchObjectUrl(
        `/console/on-duty.csv?from=${data.from}&to=${data.to}`,
      );
      a.download = `on-duty-${data.from}-to-${data.to}.csv`;
      a.click();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const days = data ? [...new Set(data.entries.map((e) => e.date))] : [];
  return (
    <section className="card stack" aria-labelledby="h-roster">
      <div className="spread wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <h2 id="h-roster" style={{ margin: 0 }}>
          Who&apos;s on duty
        </h2>
        {data && (
          <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <div>
              <label htmlFor="r-from" className="small">
                From
              </label>
              <input
                id="r-from"
                type="date"
                value={data.from}
                onChange={(e) =>
                  e.target.value &&
                  setRange({
                    from: e.target.value,
                    to: e.target.value > data.to ? e.target.value : data.to,
                  })
                }
              />
            </div>
            <div>
              <label htmlFor="r-to" className="small">
                To
              </label>
              <input
                id="r-to"
                type="date"
                value={data.to}
                min={data.from}
                onChange={(e) =>
                  e.target.value &&
                  setRange({ from: data.from, to: e.target.value })
                }
              />
            </div>
            <button
              className="btn small"
              onClick={csv}
              disabled={!data.entries.length}
            >
              Download CSV
            </button>
          </div>
        )}
      </div>
      {msg && <ErrorBox message={msg} />}
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.entries.length ? (
        <div className="small muted">
          Nobody in your sections is on duty{" "}
          {data && data.from === data.to ? `on ${day(data.from)}` : "then"}.
        </div>
      ) : (
        days.map((d) => (
          <div key={d} className="stack" style={{ gap: 4 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{day(d)}</h3>
            <div className="table-wrap">
              <table className="small">
                <thead>
                  <tr>
                    <th scope="col">Section</th>
                    <th scope="col">Student</th>
                    <th scope="col">Away</th>
                    <th scope="col">For</th>
                    <th scope="col">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries
                    .filter((e) => e.date === d)
                    .map((e) => (
                      <tr key={e.id}>
                        <td>{e.student.unit ?? "-"}</td>
                        <td>{who(e.student)}</td>
                        <td>{e.partLabel}</td>
                        <td>{e.purpose}</td>
                        <td>{e.ref}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

export default function OnDutyPage() {
  const me = useMe();
  const [version, setVersion] = useState(0);
  const approves = me.permissions.includes("placements.manage");
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
      <div>
        <h1 style={{ margin: 0 }}>On duty</h1>
        <p className="muted" style={{ margin: 0 }}>
          {approves
            ? "Students away from class for a drive, an off-campus interview or a placement event. Approve them here; class teachers see who is on duty in their sections, and students download a letter."
            : "Students in your sections approved by the placement cell to be away from class, for marking attendance."}
        </p>
      </div>
      <RosterView version={version} />
      {approves && <Queue onDecided={() => setVersion((v) => v + 1)} />}
    </div>
  );
}
