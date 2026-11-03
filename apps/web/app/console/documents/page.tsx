"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { localDate } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useUnits } from "@/components/UnitPicker";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

type Status = "pending" | "verified" | "rejected";
interface Request {
  id: string;
  title: string;
  instructions: string;
  unitIds: string[];
  dueOn: string;
  createdAt: string;
  closed: boolean;
  audience: number;
  submitted: number;
  verified: number;
  toReview?: number;
}
interface Detail extends Request {
  lastRemindedAt: string | null;
  students: { id: string; name: string; rollNo: string | null; file: { fileName: string; contentType: string; sizeBytes: number; status: Status; reviewNote: string | null; submittedAt: string } | null }[];
}

const STATUS: Record<Status, [string, string]> = { pending: ["To check", "warn"], verified: ["Verified", "good"], rejected: ["Sent back", "bad"] };
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const fmt = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function NewRequest({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const units = useUnits();
  const [f, setF] = useState({ title: "", instructions: "", dueOn: localDate(new Date(Date.now() + 7 * 86_400_000)) });
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      onDone((await api<Request>("/console/documents", { body: { ...f, unitIds } })).id);
    } catch (err) {
      setMsg(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={submit} style={{ maxWidth: 760 }}>
      <h1 style={{ margin: 0 }}>Ask for a document</h1>
      <div>
        <label htmlFor="d-title">What to upload</label>
        <input id="d-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={140} required placeholder="e.g. Semester 1-6 marksheets" />
      </div>
      <div>
        <label htmlFor="d-instr">Instructions (optional)</label>
        <textarea id="d-instr" className="prose" rows={3} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} maxLength={2000} placeholder="e.g. One PDF with all six marksheets, in order." />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
          From
        </legend>
        <div className="row wrap" style={{ gap: 6 }}>
          {units.map((u) => (
            <label key={u.id} className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={unitIds.includes(u.id)} onChange={(e) => setUnitIds(e.target.checked ? [...unitIds, u.id] : unitIds.filter((x) => x !== u.id))} style={{ width: "auto" }} />
              {u.name}
            </label>
          ))}
        </div>
        <div className="small muted">Leave all unticked to ask every student (placement cell only).</div>
      </fieldset>
      <div>
        <label htmlFor="d-due">Last day to upload</label>
        <input id="d-due" type="date" min={localDate(new Date())} value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} required style={{ maxWidth: 200 }} />
        <div className="small muted">Students upload a PDF, JPG or PNG up to 5 MB. Those who haven&apos;t are reminded the day before.</div>
      </div>
      {msg && <ErrorBox message={msg} />}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Sending..." : "Ask students"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Review({ requestId, student, onDone }: { requestId: string; student: Detail["students"][number]; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const file = student.file!;
  async function open() {
    setMsg(null);
    try {
      window.open(await fetchObjectUrl(`/console/documents/${requestId}/files/${student.id}`), "_blank", "noopener");
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  async function decide(verify: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/console/documents/${requestId}/review`, { body: { userId: student.id, verify, note: verify ? null : note } });
      onDone();
    } catch (e) {
      setMsg(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn small" onClick={open}>
          Open {file.fileName}
        </button>
        <span className="small muted">
          {Math.max(1, Math.round(file.sizeBytes / 1024))} KB · {fmt(file.submittedAt)}
        </span>
      </div>
      {file.status === "pending" && (
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn primary small" disabled={busy} onClick={() => decide(true)}>
            Verify
          </button>
          <input aria-label={`What's wrong with ${student.name}'s file`} placeholder="What's wrong, to send it back" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={{ maxWidth: 320 }} />
          <button className="btn small" disabled={busy || !note.trim()} onClick={() => decide(false)}>
            Send back
          </button>
        </div>
      )}
      {file.status === "rejected" && file.reviewNote && <div className="small muted">Sent back: {file.reviewNote}</div>}
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

function RequestView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, reload } = useApi<Detail>(`/console/documents/${id}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const missing = data.students.filter((s) => !s.file || s.file.status === "rejected").length;
  const nextRemind = data.lastRemindedAt ? new Date(new Date(data.lastRemindedAt).getTime() + 12 * 3_600_000) : null;
  const canRemind = !nextRemind || nextRemind.getTime() <= Date.now();
  async function act(path: "remind" | "close") {
    if (path === "close" && !window.confirm("Close this request? Students can't upload any more.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ reminded?: number }>(`/console/documents/${id}/${path}`, { body: {} });
      setMsg(path === "remind" ? `Reminded ${r.reminded} students.` : "Closed.");
      await reload();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← All requests
        </button>
        <h1 style={{ margin: "6px 0 0" }}>{data.title}</h1>
        <div className="small muted">
          Due {fmtDay(data.dueOn)} · {data.submitted} of {data.audience} uploaded · {data.verified} verified{data.closed ? " · closed" : ""}
        </div>
        {data.instructions && <p style={{ whiteSpace: "pre-wrap" }}>{data.instructions}</p>}
      </div>
      <div className="row wrap">
        {!data.closed && missing > 0 && canRemind && (
          <button className="btn small" disabled={busy} onClick={() => act("remind")}>
            Remind {missing} who still need to upload
          </button>
        )}
        {!data.closed && (
          <button className="btn ghost small" disabled={busy} onClick={() => act("close")}>
            Close request
          </button>
        )}
        {data.lastRemindedAt && (
          <span className="small muted">
            Last reminded {fmt(data.lastRemindedAt)}.{!canRemind && missing > 0 ? ` You can remind them again from ${fmt(nextRemind!.toISOString())}.` : ""}
          </span>
        )}
      </div>
      {msg && (
        <div className="small" role="status">
          {msg}
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Roll no</th>
                <th>Student</th>
                <th>Status</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.id}>
                  <td className="small">{s.rollNo ?? "-"}</td>
                  <td>{s.name}</td>
                  <td>{s.file ? <span className={`pill ${STATUS[s.file.status][1]}`}>{STATUS[s.file.status][0]}</span> : <span className="pill">Not uploaded</span>}</td>
                  <td>{s.file ? <Review requestId={data.id} student={s} onDone={reload} /> : <span className="small muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Documents() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const isNew = params.get("view") === "new";
  const list = useApi<{ requests: Request[] }>(id || isNew ? null : "/console/documents");
  const go = (q: string) => router.push(`/console/documents${q}`);
  if (id) return <RequestView key={id} id={id} onBack={() => go("")} />;
  if (isNew) return <NewRequest onDone={(rid) => router.replace(`/console/documents?id=${rid}`)} onCancel={() => go("")} />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Documents</h1>
          <p className="muted" style={{ margin: 0 }}>
            Marksheets, ID proof and other files students upload for the placement cell to check.
          </p>
        </div>
        <button className="btn primary" onClick={() => go("?view=new")}>
          Ask for a document
        </button>
      </div>
      {list.error ? (
        <ErrorBox message={list.error.message} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.requests.length ? (
        <div className="card muted">No document requests yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Due</th>
                  <th>Uploaded</th>
                  <th>To check</th>
                  <th>Verified</th>
                </tr>
              </thead>
              <tbody>
                {list.data.requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a
                        href={`/console/documents?id=${r.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          go(`?id=${r.id}`);
                        }}
                      >
                        {r.title}
                      </a>
                      {r.closed && <span className="small muted"> · closed</span>}
                    </td>
                    <td className="small">{fmtDay(r.dueOn)}</td>
                    <td>
                      {r.submitted} of {r.audience}
                    </td>
                    <td>{r.toReview ? <span className="pill warn">{r.toReview}</span> : "-"}</td>
                    <td>{r.verified}</td>
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

export default function DocumentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Documents />
    </Suspense>
  );
}
