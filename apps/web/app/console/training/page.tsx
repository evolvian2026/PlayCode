"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { ATTENDANCE_TARGET_PCT, TRAINING_KINDS, type TrainingKind } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { UnitPicker, useUnits } from "@/components/UnitPicker";
import { api, errorMessage, useApi } from "@/lib/api";

interface Session {
  id: string;
  title: string;
  kind: TrainingKind;
  kindLabel: string;
  trainer: string;
  location: string;
  startsAt: string;
  durationMinutes: number;
  unitIds: string[];
  status: "scheduled" | "cancelled";
  checkInOpen: boolean;
  present?: number;
}

interface Detail extends Session {
  invited: number;
  present: number;
  late: number;
  canOpenCheckIn: boolean;
  students: { id: string; name: string; rollNo: string | null; status: "present" | "late" | "absent" | "expected"; method: "code" | "staff" | null }[];
}

const fmt = (d: string) => new Date(d).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const STATUS: Record<Detail["students"][number]["status"], [string, string]> = { present: ["Present", "good"], late: ["Late", "warn"], absent: ["Absent", "bad"], expected: ["Expected", ""] };

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NewSession({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const units = useUnits();
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(10, 0, 0, 0);
  const [f, setF] = useState({ title: "", kind: "aptitude" as TrainingKind, trainer: "", location: "", startsAt: toLocalInput(tomorrow), durationMinutes: 90 });
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api<Session>("/console/training", { body: { ...f, startsAt: new Date(f.startsAt).toISOString(), unitIds } });
      onDone(s.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} style={{ maxWidth: 820 }}>
      <h2 style={{ margin: 0 }}>Schedule a session</h2>
      <div className="row wrap">
        <div style={{ flex: 2, minWidth: 240 }}>
          <label htmlFor="tr-title">Title</label>
          <input id="tr-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Quant: time and work" required maxLength={120} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="tr-kind">Kind</label>
          <select id="tr-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as TrainingKind })}>
            {Object.entries(TRAINING_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="tr-trainer">Trainer</label>
          <input id="tr-trainer" value={f.trainer} onChange={(e) => setF({ ...f, trainer: e.target.value })} placeholder="e.g. Mr. Suresh Iyer" required maxLength={120} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="tr-where">Where</label>
          <input id="tr-where" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Seminar hall 1" required maxLength={120} />
        </div>
      </div>
      <div className="row wrap">
        <div style={{ flex: 2, minWidth: 220 }}>
          <label htmlFor="tr-start">Starts</label>
          <input id="tr-start" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required />
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label htmlFor="tr-mins">Minutes</label>
          <input id="tr-mins" type="number" min={15} max={480} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} />
        </div>
      </div>
      <div>
        <label>For</label>
        <div className="row wrap" style={{ gap: 6 }}>
          {units.map((u) => (
            <button
              type="button"
              key={u.id}
              className={`btn small ${unitIds.includes(u.id) ? "primary" : ""}`}
              aria-pressed={unitIds.includes(u.id)}
              onClick={() => setUnitIds(unitIds.includes(u.id) ? unitIds.filter((x) => x !== u.id) : [...unitIds, u.id])}
            >
              {u.name}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>
          A department or batch includes its sections. Choose none for every student (institution-wide staff only). Students are told when you schedule it, and reminded the day before.
        </p>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Scheduling..." : "Schedule"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The code for the projector, refreshed as it changes. */
function CodeDisplay({ id }: { id: string }) {
  const [code, setCode] = useState<{ code: string; changesInMs: number; at: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const c = await api<{ code: string; changesInMs: number }>(`/console/training/${id}/code`);
        if (stop) return;
        setCode({ ...c, at: Date.now() });
        setError(null);
        timer = setTimeout(load, Math.max(500, c.changesInMs + 200));
      } catch (e) {
        if (!stop) setError(errorMessage(e));
      }
    };
    void load();
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      stop = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [id]);
  if (error) return <ErrorBox message={error} />;
  if (!code) return <Loading />;
  const left = Math.max(0, Math.ceil((code.changesInMs - (now - code.at)) / 1000));
  return (
    <div className="card stack center" style={{ background: "var(--surface-2)" }}>
      <div className="small muted">Students open Training in PlayCode and type</div>
      <div aria-live="polite" style={{ fontFamily: "var(--mono)", fontSize: "4rem", fontWeight: 700, letterSpacing: "0.2em" }}>
        {code.code.slice(0, 3)} {code.code.slice(3)}
      </div>
      <div className="small muted">Changes in {left}s</div>
    </div>
  );
}

function SessionView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, reload } = useApi<Detail>(`/console/training/${id}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // A ticked box shows at once; the list catches up when the server has saved it.
  const [marking, setMarking] = useState<Record<string, boolean>>({});
  // While check-in is open, refresh the list as students check in.
  useEffect(() => {
    if (!data?.checkInOpen) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [data?.checkInOpen, reload]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  async function act(path: string, body: object = {}) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/console/training/${id}/${path}`, { body });
      await reload();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function mark(userId: string, present: boolean) {
    setMarking((m) => ({ ...m, [userId]: present }));
    setMsg(null);
    try {
      await api(`/console/training/${id}/attendance`, { body: { userId, present } });
      await reload();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setMarking(({ [userId]: _, ...rest }) => rest);
    }
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← All sessions
        </button>
        <h1 style={{ margin: "6px 0 0" }}>{data.title}</h1>
        <div className="small muted">
          {data.kindLabel} · {fmt(data.startsAt)} · {data.durationMinutes} min · {data.location} · {data.trainer}
          {data.status === "cancelled" ? " · cancelled" : ""}
        </div>
      </div>
      {data.status === "scheduled" && (
        <div className="card stack">
          <div className="spread wrap">
            <h2 style={{ margin: 0 }}>Check-in</h2>
            {data.checkInOpen ? (
              <button className="btn" disabled={busy} onClick={() => act("check-in", { open: false })}>
                Close check-in
              </button>
            ) : (
              <button className="btn primary" disabled={busy || !data.canOpenCheckIn} onClick={() => act("check-in", { open: true })}>
                Open check-in
              </button>
            )}
          </div>
          {data.checkInOpen ? (
            <CodeDisplay id={id} />
          ) : (
            <div className="small muted">
              {data.canOpenCheckIn
                ? "Open check-in and put the code on the projector. It changes every 30 seconds, so a code sent to someone outside the room stops working."
                : "Check-in can be opened from 30 minutes before the start. You can mark students by hand below at any time."}
            </div>
          )}
        </div>
      )}
      {msg && <ErrorBox message={msg} />}
      <div className="card" style={{ padding: 0 }}>
        <div className="spread" style={{ padding: "12px 16px" }}>
          <h2 style={{ margin: 0 }}>Attendance</h2>
          <span className="small">
            {data.present} of {data.invited} present{data.late ? ` (${data.late} late)` : ""}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Roll no</th>
                <th>Student</th>
                <th>Status</th>
                <th>Present</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => {
                const [label, tone] = STATUS[s.status];
                const here = s.status === "present" || s.status === "late";
                return (
                  <tr key={s.id}>
                    <td className="small">{s.rollNo ?? "-"}</td>
                    <td>{s.name}</td>
                    <td>
                      <span className={`pill ${tone}`}>{label}</span>
                      {s.method === "staff" && <span className="small muted"> · marked by staff</span>}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${s.name} present`}
                        checked={marking[s.id] ?? here}
                        disabled={busy || s.id in marking || data.status === "cancelled"}
                        onChange={(e) => mark(s.id, e.target.checked)}
                        style={{ width: "auto" }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {data.status === "scheduled" && new Date(data.startsAt).getTime() + data.durationMinutes * 60_000 > Date.now() && (
        <button className="btn danger small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => window.confirm("Cancel this session? Invited students are told.") && act("cancel")}>
          Cancel session
        </button>
      )}
    </div>
  );
}

function AttendanceReport() {
  const [unitId, setUnitId] = useState("");
  const { data, error, loading, reload } = useApi<{ sessionsHeld: number; students: { id: string; name: string; rollNo: string | null; sessions: number; attended: number; pct: number | null }[] }>(
    `/console/training/attendance${unitId ? `?unitId=${unitId}` : ""}`,
  );
  const below = data?.students.filter((s) => s.pct !== null && s.pct < ATTENDANCE_TARGET_PCT).length ?? 0;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="spread wrap">
        <p className="muted" style={{ margin: 0 }}>
          Attendance over sessions held so far, lowest first. Below {ATTENDANCE_TARGET_PCT}% is flagged.
        </p>
        <UnitPicker value={unitId} onChange={setUnitId} />
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.sessionsHeld ? (
        <div className="card muted">No sessions held yet.</div>
      ) : (
        <>
          <div className="small">
            {data.sessionsHeld} sessions held · <b>{below}</b> students below {ATTENDANCE_TARGET_PCT}%
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Attended</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.name} <span className="small muted">{s.rollNo}</span>
                      </td>
                      <td>
                        {s.attended} of {s.sessions}
                      </td>
                      <td>{s.pct === null ? <span className="muted">-</span> : <span className={`pill ${s.pct >= ATTENDANCE_TARGET_PCT ? "good" : s.pct >= 50 ? "warn" : "bad"}`}>{s.pct}%</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SessionTable({ title, rows, onOpen }: { title: string; rows: Session[]; onOpen: (id: string) => void }) {
  if (!rows.length) return null;
  return (
    <div className="card" style={{ padding: 0 }}>
      <h2 style={{ margin: 0, padding: "12px 16px" }}>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>When</th>
              <th>Where</th>
              <th>Present</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <a
                    href={`/console/training?id=${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen(s.id);
                    }}
                  >
                    {s.title}
                  </a>
                  <div className="small muted">
                    {s.kindLabel} · {s.trainer}
                    {s.status === "cancelled" ? " · cancelled" : s.checkInOpen ? " · check-in open" : ""}
                  </div>
                </td>
                <td className="small">{fmt(s.startsAt)}</td>
                <td className="small">{s.location}</td>
                <td>{s.status === "cancelled" ? "-" : s.present}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Training() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const view = params.get("view");
  const list = useApi<{ upcoming: Session[]; past: Session[] }>(id || view === "new" ? null : "/console/training");
  const go = (q: string) => router.push(`/console/training${q}`);
  if (id) return <SessionView id={id} onBack={() => go("")} />;
  if (view === "new") return <NewSession onDone={(sid) => router.replace(`/console/training?id=${sid}`)} onCancel={() => go("")} />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Training sessions</h1>
          <p className="muted" style={{ margin: 0 }}>
            Placement training classes and workshops, with attendance taken by a code in the room.
          </p>
        </div>
        <button className="btn primary" onClick={() => go("?view=new")}>
          Schedule a session
        </button>
      </div>
      <div className="row" role="group" aria-label="Show">
        <button className={`btn small ${view !== "attendance" ? "primary" : ""}`} aria-pressed={view !== "attendance"} onClick={() => go("")}>
          Sessions
        </button>
        <button className={`btn small ${view === "attendance" ? "primary" : ""}`} aria-pressed={view === "attendance"} onClick={() => go("?view=attendance")}>
          Attendance by student
        </button>
      </div>
      {view === "attendance" ? (
        <AttendanceReport />
      ) : list.error ? (
        <ErrorBox message={list.error.message} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.upcoming.length && !list.data?.past.length ? (
        <div className="card muted">No sessions yet.</div>
      ) : (
        <>
          <SessionTable title="Upcoming" rows={list.data.upcoming} onOpen={(sid) => go(`?id=${sid}`)} />
          <SessionTable title="Past" rows={list.data.past} onOpen={(sid) => go(`?id=${sid}`)} />
        </>
      )}
    </div>
  );
}

export default function TrainingPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Training />
    </Suspense>
  );
}
