"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

type Status = "open" | "answered" | "closed";
interface Row {
  id: string;
  categoryLabel: string;
  subject: string;
  status: Status;
  correctionPending: boolean;
  updatedAt: string;
  student: { id: string; name: string; rollNo: string | null };
}
interface Detail {
  id: string;
  categoryLabel: string;
  subject: string;
  status: Status;
  correction: { field: string; label: string; current: number | null; proposed: number; status: "pending" | "applied" | "declined" } | null;
  messages: { id: string; fromStaff: boolean; body: string; createdAt: string; author: string | null }[];
  student: { id: string; name: string; rollNo: string | null; email: string };
  record: { cgpa: number | null; backlogs: number | null; tenthPct: number | null; twelfthPct: number | null; graduationYear: number | null } | null;
}

const TABS: [Status, string][] = [
  ["open", "Waiting for you"],
  ["answered", "Answered"],
  ["closed", "Closed"],
];
const fmt = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function TicketView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, reload, setData } = useApi<Detail>(`/console/help/${id}`);
  const [reply, setReply] = useState("");
  const [close, setClose] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  async function call(path: string, body: object) {
    setBusy(true);
    setMsg(null);
    try {
      setData(await api<Detail>(`/console/help/${id}/${path}`, { body }));
      setReply("");
      setNote("");
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const r = data.record;
  const c = data.correction;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 860 }}>
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← Helpdesk
        </button>
        <h1 style={{ margin: "6px 0 0" }}>{data.subject}</h1>
        <div className="small muted">
          {data.categoryLabel} · <a href={`/console/students/${data.student.id}`}>{data.student.name}</a> {data.student.rollNo ? `(${data.student.rollNo})` : ""} · {data.student.email} · {data.status}
        </div>
      </div>
      <div className="card tight small">
        Record: CGPA {r?.cgpa ?? "-"} · backlogs {r?.backlogs ?? "-"} · class 10 {r?.tenthPct ?? "-"}% · class 12 {r?.twelfthPct ?? "-"}% · graduating {r?.graduationYear ?? "-"}
      </div>
      {c && (
        <div className="card stack" style={{ borderColor: c.status === "pending" ? "var(--warn)" : undefined }}>
          <h2 style={{ margin: 0 }}>Correction asked for</h2>
          <div>
            {c.label}: <b>{c.current ?? "not on record"}</b> → <b>{c.proposed}</b>
            <span className="small muted"> · {c.status === "pending" ? "check it against the university result first" : c.status}</span>
          </div>
          {c.status === "pending" && (
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn primary small" disabled={busy} onClick={() => call("correction", { apply: true })}>
                Apply: set {c.label} to {c.proposed}
              </button>
              <input aria-label="Why it stays as it is" placeholder="Why it stays as it is" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={{ maxWidth: 320 }} />
              <button className="btn small" disabled={busy || !note.trim()} onClick={() => call("correction", { apply: false, note })}>
                Keep the record
              </button>
            </div>
          )}
        </div>
      )}
      {data.messages.map((m) => (
        <div key={m.id} className="card stack" style={{ gap: 4, marginLeft: m.fromStaff ? 24 : 0, borderColor: m.fromStaff ? "var(--accent)" : undefined }}>
          <div className="small muted">
            {m.fromStaff ? m.author : data.student.name} · {fmt(m.createdAt)}
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
        </div>
      ))}
      {data.status !== "closed" ? (
        <div className="stack">
          <label htmlFor="r-body">Reply</label>
          <textarea id="r-body" className="prose" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={3000} />
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} style={{ width: "auto" }} />
            Close the question with this reply
          </label>
          <div className="row">
            <button className="btn primary small" disabled={busy || reply.trim().length < 2} onClick={() => call("reply", { body: reply, close })}>
              Send reply
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => call("close", {})}>
              Close without replying
            </button>
          </div>
        </div>
      ) : (
        <div className="small muted">Closed. The student can ask a new question.</div>
      )}
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

function Helpdesk() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const [tab, setTab] = useState<Status>("open");
  const { data, error, loading, reload } = useApi<{ counts: { open: number }; tickets: Row[] }>(id ? null : `/console/help?status=${tab}`);
  if (id) return <TicketView key={id} id={id} onBack={() => router.push("/console/help")} />;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
      <div>
        <h1 style={{ margin: 0 }}>Helpdesk</h1>
        <p className="muted" style={{ margin: 0 }}>
          Students&apos; questions to the placement cell, oldest first, with any record corrections they asked for.
        </p>
      </div>
      <div className="row" role="group" aria-label="Show">
        {TABS.map(([k, label]) => (
          <button key={k} className={`btn small ${tab === k ? "primary" : ""}`} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {label}
            {k === "open" && data?.counts.open ? ` (${data.counts.open})` : ""}
          </button>
        ))}
      </div>
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.tickets.length ? (
        <div className="card muted">{tab === "open" ? "No questions waiting." : "None."}</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Student</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <a
                        href={`/console/help?id=${q.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(`/console/help?id=${q.id}`);
                        }}
                      >
                        {q.subject}
                      </a>
                      <div className="small muted">
                        {q.categoryLabel}
                        {q.correctionPending ? " · correction to check" : ""}
                      </div>
                    </td>
                    <td>
                      {q.student.name}
                      <div className="small muted">{q.student.rollNo}</div>
                    </td>
                    <td className="small">{fmt(q.updatedAt)}</td>
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

export default function HelpdeskPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Helpdesk />
    </Suspense>
  );
}
