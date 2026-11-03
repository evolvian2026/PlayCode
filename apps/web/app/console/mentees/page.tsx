"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { localDate, MEETING_MODES, MENTEE_FLAGS, type MeetingMode, type MenteeFlag } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Mentee {
  id: string;
  name: string;
  rollNo: string | null;
  readiness: { service: number; product: number };
  lastActive: string | null;
  attendancePct: number | null;
  latestTest: { title: string; pct: number } | null;
  lastMeeting: string | null;
  nextFollowUp: string | null;
  meetings: number;
  flags: MenteeFlag[];
}

interface MenteeRecord {
  student: { id: string; name: string; rollNo: string | null; email: string };
  mentor: { id: string; name: string } | null;
  canLog: boolean;
  meetings: { id: string; meetingDate: string; mode: MeetingMode; notes: string; actionPoints: string; followUpOn: string | null; by: string | null }[];
}

function MeetingForm({ studentId, onSaved }: { studentId: string; onSaved: (r: MenteeRecord) => void }) {
  const today = localDate(new Date());
  const [f, setF] = useState({ meetingDate: today, mode: "in_person" as MeetingMode, notes: "", actionPoints: "", followUpOn: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<MenteeRecord>(`/console/mentees/${studentId}/meetings`, { body: { ...f, followUpOn: f.followUpOn || null } });
      setF({ ...f, notes: "", actionPoints: "", followUpOn: "" });
      onSaved(r);
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>Record a meeting</h2>
      <div className="row wrap">
        <div>
          <label htmlFor="m-date">Date</label>
          <input id="m-date" type="date" max={today} value={f.meetingDate} onChange={(e) => setF({ ...f, meetingDate: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="m-mode">How</label>
          <select id="m-mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as MeetingMode })}>
            {Object.entries(MEETING_MODES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="m-follow">Follow up on (optional)</label>
          <input id="m-follow" type="date" min={f.meetingDate} value={f.followUpOn} onChange={(e) => setF({ ...f, followUpOn: e.target.value })} />
        </div>
      </div>
      <div>
        <label htmlFor="m-notes">Notes (staff only)</label>
        <textarea id="m-notes" className="prose" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={4000} placeholder="What you discussed. Students don't see these, but they're included if a student asks for their data." />
      </div>
      <div>
        <label htmlFor="m-actions">Action points (the student sees these)</label>
        <textarea id="m-actions" className="prose" rows={2} value={f.actionPoints} onChange={(e) => setF({ ...f, actionPoints: e.target.value })} maxLength={2000} placeholder="e.g. Finish the percentages mission and attend Friday's quant session." />
      </div>
      {msg && <ErrorBox message={msg} />}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy}>
        {busy ? "Saving..." : "Save meeting"}
      </button>
    </form>
  );
}

function MenteeView({ id }: { id: string }) {
  const { data, error, loading, reload, setData } = useApi<MenteeRecord>(`/console/mentees/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 860 }}>
      <div>
        <Link href="/console/mentees" className="small muted">
          ← My mentees
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>
          <Link href={`/console/students/${data.student.id}`} style={{ color: "inherit" }}>
            {data.student.name}
          </Link>
        </h1>
        <div className="small muted">
          {data.student.rollNo} · {data.student.email} · mentor {data.mentor?.name ?? "not assigned"}
        </div>
      </div>
      {data.canLog && <MeetingForm studentId={id} onSaved={setData} />}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Meetings</h2>
        {data.meetings.length === 0 ? (
          <div className="muted small">No meetings recorded yet.</div>
        ) : (
          data.meetings.map((m) => (
            <div key={m.id} className="stack" style={{ gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div className="small">
                <b>{m.meetingDate}</b> · {MEETING_MODES[m.mode]}
                {m.by ? ` · ${m.by}` : ""}
                {m.followUpOn ? ` · follow up ${m.followUpOn}` : ""}
              </div>
              {m.notes && <div style={{ whiteSpace: "pre-wrap" }}>{m.notes}</div>}
              {m.actionPoints && (
                <div className="small" style={{ background: "var(--surface-2)", padding: "6px 10px", borderRadius: 8 }}>
                  <b>Action points:</b> {m.actionPoints}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function MenteeList() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ mentees: Mentee[]; counts: { mentees: number; needAttention: number } }>("/console/mentees");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1 style={{ margin: 0 }}>My mentees</h1>
        <p className="muted" style={{ margin: 0 }}>
          {data.counts.mentees} students · {data.counts.needAttention} need attention. Those with the most to look at come first.
        </p>
      </div>
      {data.mentees.length === 0 ? (
        <div className="card muted">No mentees assigned to you yet. The placement cell or your HOD assigns them under Mentor assignment.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Readiness</th>
                  <th>Training</th>
                  <th>Last class test</th>
                  <th>Last met</th>
                  <th>Needs attention</th>
                </tr>
              </thead>
              <tbody>
                {data.mentees.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <a
                        href={`/console/mentees?id=${m.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(`/console/mentees?id=${m.id}`);
                        }}
                      >
                        {m.name}
                      </a>
                      <div className="small muted">{m.rollNo}</div>
                    </td>
                    <td className="small">
                      Service {m.readiness.service} · Product {m.readiness.product}
                    </td>
                    <td className="small">{m.attendancePct === null ? "-" : `${m.attendancePct}%`}</td>
                    <td className="small">{m.latestTest ? `${m.latestTest.pct}%` : "-"}</td>
                    <td className="small">{m.lastMeeting ?? "Never"}</td>
                    <td>
                      <div className="row wrap" style={{ gap: 4 }}>
                        {m.flags.length === 0 ? (
                          <span className="pill good">On track</span>
                        ) : (
                          m.flags.map((f) => (
                            <span key={f} className={`pill ${f === "follow_up_due" || f === "at_risk" ? "bad" : "warn"}`}>
                              {f === "no_meeting" && !m.lastMeeting ? "Not met yet" : MENTEE_FLAGS[f]}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Mentees() {
  const id = useSearchParams().get("id");
  return id ? <MenteeView key={id} id={id} /> : <MenteeList />;
}

export default function MenteesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Mentees />
    </Suspense>
  );
}
