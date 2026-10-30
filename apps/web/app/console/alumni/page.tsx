"use client";

import { useState, type FormEvent } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Alumnus {
  id: string;
  name: string;
  email: string;
  graduationYear: number;
  department: string;
  company: string;
  role: string;
  city: string;
  openToReferrals: boolean;
  openToAdvice: boolean;
  active: boolean;
  introsSent: number;
}
interface Intro {
  id: string;
  purposeLabel: string;
  message: string;
  createdAt: string;
  decidedAt: string | null;
  declineNote: string | null;
  student: { id: string; name: string; rollNo: string | null };
  alumnus: { id: string; name: string; company: string; role: string; graduationYear: number };
}

const day = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const blank = { name: "", email: "", graduationYear: String(new Date().getFullYear() - 1), department: "", company: "", role: "", city: "", openToReferrals: false, openToAdvice: true, active: true };

function AlumnusForm({ initial, onSaved, onCancel }: { initial: Alumnus | null; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState(initial ? { ...initial, graduationYear: String(initial.graduationYear) } : blank);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const body = { name: f.name, email: f.email, graduationYear: Number(f.graduationYear), department: f.department, company: f.company, role: f.role, city: f.city, openToReferrals: f.openToReferrals, openToAdvice: f.openToAdvice, active: f.active };
      await api(initial ? `/console/alumni/${initial.id}` : "/console/alumni", { method: initial ? "PUT" : "POST", body });
      onSaved();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }
  const field = (k: "name" | "email" | "graduationYear" | "department" | "company" | "role" | "city", label: string, type = "text") => (
    <div>
      <label htmlFor={`al-${k}`}>{label}</label>
      <input id={`al-${k}`} type={type} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} />
    </div>
  );
  return (
    <form className="card stack" onSubmit={submit} aria-label={initial ? `Edit ${initial.name}` : "Add an alumnus"}>
      <h2 style={{ margin: 0 }}>{initial ? `Edit ${initial.name}` : "Add an alumnus"}</h2>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {field("name", "Name")}
        {field("email", "Email (never shown to students)", "email")}
        {field("graduationYear", "Graduated in", "number")}
        {field("department", "Department")}
        {field("company", "Company")}
        {field("role", "Role")}
        {field("city", "City")}
      </div>
      <div className="row wrap" style={{ gap: 14 }}>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={f.openToAdvice} onChange={(e) => set({ openToAdvice: e.target.checked })} />
          Happy to give advice
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={f.openToReferrals} onChange={(e) => set({ openToReferrals: e.target.checked })} />
          Open to referrals
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
          Shown to students
        </label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary small">Save</button>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
    </form>
  );
}

function Intros({ emailConfigured, onDecided }: { emailConfigured: boolean; onDecided: () => void }) {
  const [tab, setTab] = useState<"pending" | "sent" | "declined">("pending");
  const { data, error, loading, reload, setData } = useApi<{ intros: Intro[] }>(`/console/alumni/intros?status=${tab}`);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  async function decide(id: string, send: boolean) {
    setMsg(null);
    try {
      setData(await api<{ intros: Intro[] }>(`/console/alumni/intros/${id}`, { body: { send, note: notes[id] ?? null } }));
      setMsg(send ? "Sent. The student has been told." : "Declined. The student has your reason.");
      onDecided();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <section className="card stack" aria-labelledby="h-intros">
      <div className="spread wrap" style={{ gap: 8 }}>
        <h2 id="h-intros" style={{ margin: 0 }}>
          Introductions
        </h2>
        <div className="row" role="group" aria-label="Show">
          {(["pending", "sent", "declined"] as const).map((k) => (
            <button key={k} className={`btn small ${tab === k ? "primary" : ""}`} aria-pressed={tab === k} onClick={() => setTab(k)}>
              {{ pending: "Waiting", sent: "Sent", declined: "Declined" }[k]}
            </button>
          ))}
        </div>
      </div>
      {!emailConfigured && tab === "pending" && <div className="small" style={{ color: "var(--bad-ink)" }}>Email isn&apos;t set up on this server, so introductions can&apos;t be sent yet.</div>}
      {msg && (
        <div className="small" role="status">
          {msg}
        </div>
      )}
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.intros.length ? (
        <div className="small muted">None.</div>
      ) : (
        data.intros.map((i) => (
          <div key={i.id} className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div className="small">
              <b>{i.student.name}</b> {i.student.rollNo && <span className="muted">({i.student.rollNo})</span>} asks <b>{i.alumnus.name}</b>{" "}
              <span className="muted">
                ({i.alumnus.role ? `${i.alumnus.role}, ` : ""}
                {i.alumnus.company}, batch of {i.alumnus.graduationYear})
              </span>{" "}
              for {i.purposeLabel.toLowerCase()} · {day(i.createdAt)}
            </div>
            <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: "3px solid var(--line)", whiteSpace: "pre-wrap" }}>{i.message}</blockquote>
            {tab === "pending" ? (
              <div className="row wrap" style={{ gap: 6, alignItems: "flex-end" }}>
                <button className="btn primary small" disabled={!emailConfigured} onClick={() => decide(i.id, true)}>
                  Send with their resume
                </button>
                <input aria-label={`Why not, for ${i.student.name}`} placeholder="Why not (goes to the student)" value={notes[i.id] ?? ""} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} style={{ maxWidth: 340 }} />
                <button className="btn small" disabled={!notes[i.id]?.trim()} onClick={() => decide(i.id, false)}>
                  Decline
                </button>
              </div>
            ) : (
              i.declineNote && <div className="small muted">Declined: {i.declineNote}</div>
            )}
          </div>
        ))
      )}
    </section>
  );
}

export default function AlumniConsolePage() {
  const { data, error, loading, reload } = useApi<{ alumni: Alumnus[]; pending: number; emailConfigured: boolean }>("/console/alumni");
  const [editing, setEditing] = useState<Alumnus | "new" | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  async function remove(a: Alumnus) {
    if (!confirm(`Remove ${a.name} from the list? Their introductions are removed too.`)) return;
    await api(`/console/alumni/${a.id}`, { method: "DELETE" });
    reload();
  }
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1080 }}>
      <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Alumni</h1>
          <p className="muted" style={{ margin: 0 }}>
            Graduates happy to help current students. Students ask for an introduction; you read it and send it on by email, with their resume.
          </p>
        </div>
        {!editing && (
          <button className="btn primary small" onClick={() => setEditing("new")}>
            Add an alumnus
          </button>
        )}
      </div>
      {editing && (
        <AlumnusForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      <Intros emailConfigured={data.emailConfigured} onDecided={() => void reload()} />
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Alumnus</th>
                <th>Works at</th>
                <th>Open to</th>
                <th>Introductions</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.alumni.map((a) => (
                <tr key={a.id} style={{ opacity: a.active ? 1 : 0.6 }}>
                  <td>
                    {a.name}
                    <div className="small muted">
                      {[a.department, `batch of ${a.graduationYear}`].filter(Boolean).join(" · ")} · {a.email}
                    </div>
                  </td>
                  <td className="small">
                    {a.role ? `${a.role}, ` : ""}
                    {a.company}
                    {a.city && <div className="muted">{a.city}</div>}
                  </td>
                  <td className="small">{[a.openToAdvice && "Advice", a.openToReferrals && "Referrals"].filter(Boolean).join(", ") || "-"}{!a.active && <div className="muted">hidden</div>}</td>
                  <td className="small">{a.introsSent}</td>
                  <td className="small">
                    <button className="btn ghost small" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}>
                      Edit
                    </button>
                    <button className="btn ghost small" onClick={() => remove(a)} aria-label={`Remove ${a.name}`}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
