"use client";

import { useState } from "react";
import { DRIVE_AUDIENCES, formatLpa, MAX_COORDINATORS, type DriveAudience, type OfferDetails } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

interface Update {
  id: string;
  audienceLabel: string;
  body: string;
  recipients: number;
  by: string | null;
  createdAt: string;
}

/** Messages to some of a drive's applicants. */
export function DriveUpdates({ driveId, rounds }: { driveId: string; rounds: string[] }) {
  const { data, error, loading, reload, setData } = useApi<{ updates: Update[] }>(`/console/placements/${driveId}/updates`);
  const [audience, setAudience] = useState<DriveAudience>("all");
  const [round, setRound] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ updates: Update[] }>(`/console/placements/${driveId}/updates`, { body: { audience, round: audience === "round" ? round : null, body } });
      setData(res);
      setBody("");
      setMsg(`Sent to ${res.updates[0]!.recipients} student${res.updates[0]!.recipients === 1 ? "" : "s"}.`);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack no-print" aria-labelledby="h-updates">
      <div>
        <h2 id="h-updates" style={{ margin: 0 }}>
          Updates to students
        </h2>
        <div className="small muted">A change of venue, the shortlist, what to bring. It reaches them as a notification and stays on their drive card.</div>
      </div>
      <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <div>
          <label htmlFor="u-aud">Send to</label>
          <select id="u-aud" value={audience} onChange={(e) => setAudience(e.target.value as DriveAudience)}>
            {(Object.entries(DRIVE_AUDIENCES) as [DriveAudience, string][]).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {audience === "round" && (
          <div>
            <label htmlFor="u-round">Round</label>
            <select id="u-round" value={round} onChange={(e) => setRound(Number(e.target.value))}>
              {rounds.map((r, i) => (
                <option key={i} value={i}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div>
        <label htmlFor="u-body">Message</label>
        <textarea id="u-body" className="prose" rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} placeholder="Pre-placement talk at 9:30 in Seminar Hall 1. Be seated by 9:15." />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary small" disabled={busy || body.trim().length < 5} onClick={send}>
          Send update
        </button>
        {msg && (
          <span className="small" role="status">
            {msg}
          </span>
        )}
      </div>
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        data?.updates.map((u) => (
          <div key={u.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <div className="small muted">
              {when(u.createdAt)} · {u.audienceLabel} ({u.recipients}) · {u.by}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{u.body}</div>
          </div>
        ))
      )}
    </section>
  );
}

interface Desk {
  drive: { driveDate: string };
  expected: number;
  reported: number;
  students: { userId: string; name: string; rollNo: string | null; round: string; slot: { round: string; startsAt: string } | null; reportedAt: string | null }[];
  coordinators: { userId: string; name: string; rollNo: string | null }[];
}
interface Schedule {
  id: string;
  roundName: string;
  slots: { userId: string; status: string }[];
}

/** Student coordinators, and who has reported at the venue. */
export function ReportingDesk({ driveId }: { driveId: string }) {
  const { data, error, loading, reload, setData } = useApi<Desk>(`/console/placements/${driveId}/desk`);
  const schedules = useApi<{ schedules: Schedule[] }>(`/console/placements/${driveId}/schedules`);
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  async function check(userId: string, reported: boolean) {
    setMsg(null);
    try {
      setData(await api<Desk>(`/console/placements/${driveId}/desk/${userId}`, { method: "PUT", body: { reported } }));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  async function absent(s: Schedule) {
    const waiting = s.slots.filter((x) => x.status === "scheduled" && !data!.students.find((st) => st.userId === x.userId)?.reportedAt).length;
    if (!confirm(`Mark the ${waiting} student${waiting === 1 ? "" : "s"} with a ${s.roundName} slot who didn't report as absent? Each is told, and it counts towards the no-show rule.`)) return;
    setMsg(null);
    try {
      const r = await api<{ absent: number }>(`/console/placements/${driveId}/schedules/${s.id}/absent`, { body: {} });
      setMsg(`${r.absent} marked absent.`);
      void schedules.reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const open = (schedules.data?.schedules ?? []).filter((s) => s.slots.some((x) => x.status === "scheduled"));
  return (
    <section className="card stack no-print" aria-labelledby="h-desk">
      <div className="spread wrap">
        <div>
          <h2 id="h-desk" style={{ margin: 0 }}>
            Reporting desk
          </h2>
          <div className="small muted">
            {data.reported} of {data.expected} reported. Student coordinators check students in from their phones, from the day before the drive.
          </div>
        </div>
        <button className="btn small" onClick={() => setPicking(!picking)}>
          {picking ? "Done" : "Coordinators"}
        </button>
      </div>
      {picking ? (
        <CoordinatorPicker driveId={driveId} current={data.coordinators} candidates={new Set(data.students.map((s) => s.userId))} onSaved={() => void reload()} />
      ) : (
        <div className="small">
          Coordinators: {data.coordinators.length ? data.coordinators.map((c) => `${c.name}${c.rollNo ? ` (${c.rollNo})` : ""}`).join(", ") : <span className="muted">none yet</span>}
        </div>
      )}
      {open.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {open.map((s) => (
            <button key={s.id} className="btn ghost small" onClick={() => absent(s)}>
              Mark {s.roundName} no-reports absent
            </button>
          ))}
        </div>
      )}
      {msg && (
        <div className="small" role="status">
          {msg}
        </div>
      )}
      {data.students.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Slot</th>
                <th>Reported</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.userId}>
                  <td>
                    {s.name}
                    <div className="small muted">{s.rollNo}</div>
                  </td>
                  <td className="small">{s.slot ? `${s.slot.round}, ${new Date(s.slot.startsAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : s.round}</td>
                  <td>
                    <label className="row small" style={{ gap: 6 }}>
                      <input type="checkbox" style={{ width: "auto" }} checked={Boolean(s.reportedAt)} onChange={(e) => check(s.userId, e.target.checked)} aria-label={`${s.name} reported`} />
                      {s.reportedAt ? new Date(s.reportedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CoordinatorPicker({ driveId, current, candidates, onSaved }: { driveId: string; current: Desk["coordinators"]; candidates: Set<string>; onSaved: () => void }) {
  const all = useApi<{ students: { id: string; name: string; rollNo: string | null; unitName: string | null }[] }>("/console/students");
  const [chosen, setChosen] = useState(current.map((c) => ({ id: c.userId, name: c.name, rollNo: c.rollNo })));
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const matches = q.trim().length < 2 ? [] : (all.data?.students ?? []).filter((s) => !candidates.has(s.id) && !chosen.some((c) => c.id === s.id) && `${s.name} ${s.rollNo ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6);
  async function save() {
    setMsg(null);
    try {
      await api(`/console/placements/${driveId}/coordinators`, { method: "PUT", body: { userIds: chosen.map((c) => c.id) } });
      setMsg("Saved. New coordinators are told.");
      onSaved();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        {chosen.map((c) => (
          <span key={c.id} className="pill accent">
            {c.name} {c.rollNo && `(${c.rollNo})`}{" "}
            <button className="btn ghost small" style={{ padding: "0 4px" }} aria-label={`Remove ${c.name}`} onClick={() => setChosen(chosen.filter((x) => x.id !== c.id))}>
              ×
            </button>
          </span>
        ))}
      </div>
      {chosen.length < MAX_COORDINATORS && (
        <div>
          <label htmlFor="c-find">Add a student (not registered for this drive)</label>
          <input id="c-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or roll number" />
          {matches.map((s) => (
            <button
              key={s.id}
              className="btn ghost small"
              style={{ display: "block" }}
              onClick={() => {
                setChosen([...chosen, { id: s.id, name: s.name, rollNo: s.rollNo }]);
                setQ("");
              }}
            >
              {s.name} {s.rollNo && `(${s.rollNo})`} <span className="muted">{s.unitName}</span>
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary small" onClick={save}>
          Save coordinators
        </button>
        {msg && (
          <span className="small" role="status">
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}

/** What the offer is made of, shown to students on the drive card. */
export function OfferDetailsEditor({ driveId, ctcRupees, initial }: { driveId: string; ctcRupees: number; initial: OfferDetails | null }) {
  const lakh = (v: number | null | undefined) => (v ? String(v / 100_000) : "");
  const [f, setF] = useState({
    fixed: lakh(initial?.fixedRupees),
    variable: lakh(initial?.variableRupees),
    bonus: initial?.joiningBonusRupees ? String(initial.joiningBonusRupees) : "",
    bondMonths: initial?.bondMonths ? String(initial.bondMonths) : "",
    bondAmount: initial?.bondAmountRupees ? String(initial.bondAmountRupees) : "",
    probation: initial?.probationMonths ? String(initial.probationMonths) : "",
    notes: initial?.notes ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const num = (v: string, scale = 1) => (v.trim() === "" ? null : Math.round(Number(v) * scale));
  async function save() {
    setMsg(null);
    try {
      await api(`/console/placements/${driveId}/offer-details`, {
        method: "PUT",
        body: { fixedRupees: num(f.fixed, 100_000), variableRupees: num(f.variable, 100_000), joiningBonusRupees: num(f.bonus), bondMonths: num(f.bondMonths), bondAmountRupees: num(f.bondAmount), probationMonths: num(f.probation), notes: f.notes },
      });
      setMsg("Saved. Students see it on the drive card.");
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <section className="card stack no-print" aria-labelledby="h-offer">
      <div>
        <h2 id="h-offer" style={{ margin: 0 }}>
          What the offer is made of
        </h2>
        <div className="small muted">CTC {formatLpa(ctcRupees)}. Fill in what the company has told you; students see it before they register and when they decide.</div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <div>
          <label htmlFor="od-fixed">Fixed (lakhs a year)</label>
          <input id="od-fixed" type="number" min={0} step="any" value={f.fixed} onChange={(e) => set({ fixed: e.target.value })} />
        </div>
        <div>
          <label htmlFor="od-var">Variable (lakhs a year)</label>
          <input id="od-var" type="number" min={0} step="any" value={f.variable} onChange={(e) => set({ variable: e.target.value })} />
        </div>
        <div>
          <label htmlFor="od-bonus">Joining bonus (₹)</label>
          <input id="od-bonus" type="number" min={0} value={f.bonus} onChange={(e) => set({ bonus: e.target.value })} />
        </div>
        <div>
          <label htmlFor="od-bond">Service agreement (months)</label>
          <input id="od-bond" type="number" min={0} max={120} value={f.bondMonths} onChange={(e) => set({ bondMonths: e.target.value })} />
        </div>
        <div>
          <label htmlFor="od-bondamt">If leaving early (₹)</label>
          <input id="od-bondamt" type="number" min={0} value={f.bondAmount} onChange={(e) => set({ bondAmount: e.target.value })} />
        </div>
        <div>
          <label htmlFor="od-prob">Probation (months)</label>
          <input id="od-prob" type="number" min={0} max={24} value={f.probation} onChange={(e) => set({ probation: e.target.value })} />
        </div>
      </div>
      <div>
        <label htmlFor="od-notes">Anything else (relocation, training period, location policy)</label>
        <input id="od-notes" value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={1000} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn small" onClick={save}>
          Save offer details
        </button>
        {msg && (
          <span className="small" role="status">
            {msg}
          </span>
        )}
      </div>
    </section>
  );
}
