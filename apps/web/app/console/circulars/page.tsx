"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { localDate } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useUnits } from "@/components/UnitPicker";
import { api, errorMessage, useApi } from "@/lib/api";

interface Circular {
  id: string;
  title: string;
  body: string;
  unitIds: string[];
  requireAck: boolean;
  ackBy: string | null;
  createdAt: string;
  withdrawn: boolean;
  audience: number;
  acknowledged?: number;
}
interface Detail extends Circular {
  acknowledged: number;
  lastRemindedAt: string | null;
  students: { id: string; name: string; rollNo: string | null; acknowledgedAt: string | null }[];
}

const fmt = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function NewCircular({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const units = useUnits();
  const [f, setF] = useState({ title: "", body: "", requireAck: true, ackBy: localDate(new Date(Date.now() + 3 * 86_400_000)) });
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const c = await api<Circular>("/console/circulars", { body: { ...f, ackBy: f.requireAck ? f.ackBy : null, unitIds } });
      onDone(c.id);
    } catch (err) {
      setMsg(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={submit} style={{ maxWidth: 760 }}>
      <h1 style={{ margin: 0 }}>New circular</h1>
      <div>
        <label htmlFor="c-title">Title</label>
        <input id="c-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={140} required placeholder="e.g. TCS drive on 5 November: what to bring" />
      </div>
      <div>
        <label htmlFor="c-body">Circular</label>
        <textarea id="c-body" className="prose" rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={5000} required />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
          For
        </legend>
        <div className="row wrap" style={{ gap: 6 }}>
          {units.map((u) => (
            <label key={u.id} className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={unitIds.includes(u.id)} onChange={(e) => setUnitIds(e.target.checked ? [...unitIds, u.id] : unitIds.filter((x) => x !== u.id))} style={{ width: "auto" }} />
              {u.name}
            </label>
          ))}
        </div>
        <div className="small muted">Leave all unticked to send it to every student (placement cell only).</div>
      </fieldset>
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" checked={f.requireAck} onChange={(e) => setF({ ...f, requireAck: e.target.checked })} style={{ width: "auto" }} />
        Students must acknowledge it
      </label>
      {f.requireAck && (
        <div>
          <label htmlFor="c-ackby">Last day to acknowledge</label>
          <input id="c-ackby" type="date" min={localDate(new Date())} value={f.ackBy} onChange={(e) => setF({ ...f, ackBy: e.target.value })} required style={{ maxWidth: 200 }} />
          <div className="small muted">Students who haven't acknowledged are reminded the day before.</div>
        </div>
      )}
      {msg && <ErrorBox message={msg} />}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Sending..." : "Send circular"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CircularView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, reload } = useApi<Detail>(`/console/circulars/${id}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  async function act(path: "remind" | "withdraw") {
    if (path === "withdraw" && !window.confirm("Withdraw this circular? Students won't see it any more.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ reminded?: number }>(`/console/circulars/${id}/${path}`, { body: {} });
      setMsg(path === "remind" ? `Reminded ${r.reminded} students.` : "Withdrawn.");
      await reload();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const pending = data.students.filter((s) => !s.acknowledgedAt);
  // Reminders go at most every 12 hours.
  const nextRemind = data.lastRemindedAt ? new Date(new Date(data.lastRemindedAt).getTime() + 12 * 3_600_000) : null;
  const canRemind = !nextRemind || nextRemind.getTime() <= Date.now();
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← All circulars
        </button>
        <h1 style={{ margin: "6px 0 0" }}>{data.title}</h1>
        <div className="small muted">
          Sent {fmt(data.createdAt)} to {data.audience} students{data.withdrawn ? " · withdrawn" : ""}
        </div>
      </div>
      <div className="card" style={{ whiteSpace: "pre-wrap" }}>
        {data.body}
      </div>
      {data.requireAck && (
        <div className="card stack">
          <div className="spread wrap">
            <div>
              <h2 style={{ margin: 0 }}>
                {data.acknowledged} of {data.audience} acknowledged
              </h2>
              {data.ackBy && <div className="small muted">Due {new Date(`${data.ackBy}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>}
            </div>
            {!data.withdrawn && pending.length > 0 && canRemind && (
              <button className="btn small" disabled={busy} onClick={() => act("remind")}>
                Remind {pending.length} who haven&apos;t
              </button>
            )}
          </div>
          {data.lastRemindedAt && (
            <div className="small muted">
              Last reminded {fmt(data.lastRemindedAt)}.{!canRemind && pending.length > 0 ? ` You can remind them again from ${fmt(nextRemind!.toISOString())}.` : ""}
            </div>
          )}
          {msg && (
            <div className="small" role="status">
              {msg}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Roll no</th>
                  <th>Student</th>
                  <th>Acknowledged</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((s) => (
                  <tr key={s.id}>
                    <td className="small">{s.rollNo ?? "-"}</td>
                    <td>{s.name}</td>
                    <td>{s.acknowledgedAt ? <span className="small">{fmt(s.acknowledgedAt)}</span> : <span className="pill warn">Not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!data.withdrawn && (
        <button className="btn danger small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => act("withdraw")}>
          Withdraw circular
        </button>
      )}
    </div>
  );
}

function Circulars() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const isNew = params.get("view") === "new";
  const list = useApi<{ circulars: Circular[] }>(id || isNew ? null : "/console/circulars");
  const go = (q: string) => router.push(`/console/circulars${q}`);
  if (id) return <CircularView key={id} id={id} onBack={() => go("")} />;
  if (isNew) return <NewCircular onDone={(cid) => router.replace(`/console/circulars?id=${cid}`)} onCancel={() => go("")} />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Circulars</h1>
          <p className="muted" style={{ margin: 0 }}>
            Notices to students, with a record of who has acknowledged them.
          </p>
        </div>
        <button className="btn primary" onClick={() => go("?view=new")}>
          New circular
        </button>
      </div>
      {list.error ? (
        <ErrorBox message={list.error.message} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.circulars.length ? (
        <div className="card muted">No circulars yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Circular</th>
                  <th>Sent</th>
                  <th>Students</th>
                  <th>Acknowledged</th>
                </tr>
              </thead>
              <tbody>
                {list.data.circulars.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a
                        href={`/console/circulars?id=${c.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          go(`?id=${c.id}`);
                        }}
                      >
                        {c.title}
                      </a>
                      {c.withdrawn && <span className="small muted"> · withdrawn</span>}
                    </td>
                    <td className="small">{fmt(c.createdAt)}</td>
                    <td>{c.audience}</td>
                    <td>{c.requireAck ? `${c.acknowledged} (${c.audience ? Math.round(((c.acknowledged ?? 0) / c.audience) * 100) : 0}%)` : <span className="small muted">Not asked</span>}</td>
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

export default function CircularsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Circulars />
    </Suspense>
  );
}
