"use client";

import { useState } from "react";
import { formatLpa, JOINING_STATUSES, type JoiningStatus } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Offer {
  driveId: string;
  userId: string;
  name: string;
  rollNo: string | null;
  company: string;
  roleTitle: string;
  driveDate: string;
  ctcRupees: number;
  status: JoiningStatus | null;
  statusLabel: string;
  joiningDate: string | null;
  note: string;
  updatedAt: string | null;
  delayed: boolean;
}
interface Board {
  offers: Offer[];
  companies: { company: string; accepted: number; joined: number; dateGiven: number; letterReceived: number; awaitingLetter: number; notUpdated: number; revoked: number; delayed: number; nextJoining: string | null }[];
  totals: { accepted: number; joined: number; delayed: number; revoked: number };
}

const TONE: Record<JoiningStatus, string> = { awaiting_letter: "", letter_received: "accent", date_given: "accent", joined: "good", revoked: "bad" };
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Edit({ o, onSaved, onCancel }: { o: Offer; onSaved: (b: Board) => void; onCancel: () => void }) {
  const [status, setStatus] = useState<JoiningStatus>(o.status ?? "awaiting_letter");
  const [date, setDate] = useState(o.joiningDate ?? "");
  const [note, setNote] = useState(o.note);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsDate = status === "date_given" || status === "joined";
  async function save() {
    if (status === "revoked" && !confirm(`Record ${o.name}'s ${o.company} offer as withdrawn? It stops counting as an offer they hold, and as a placement.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      onSaved(await api<Board>(`/console/joining/${o.driveId}/${o.userId}`, { method: "PUT", body: { status, joiningDate: needsDate ? date || null : null, note } }));
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const id = `e-${o.driveId}-${o.userId}`;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap" style={{ gap: 6, alignItems: "flex-end" }}>
        <div>
          <label htmlFor={`${id}-s`} className="small">
            Status
          </label>
          <select id={`${id}-s`} value={status} onChange={(e) => setStatus(e.target.value as JoiningStatus)}>
            {(Object.entries(JOINING_STATUSES) as [JoiningStatus, string][]).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {needsDate && (
          <div>
            <label htmlFor={`${id}-d`} className="small">
              Joining date
            </label>
            <input id={`${id}-d`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor={`${id}-n`} className="small">
            Note{status === "revoked" ? " (what the company said)" : ""}
          </label>
          <input id={`${id}-n`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary small" disabled={busy || (needsDate && !date) || (status === "revoked" && !note.trim())} onClick={save}>
          Save
        </button>
        <button className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

export default function JoiningPage() {
  const { data, error, loading, reload, setData } = useApi<Board>("/console/joining");
  const [company, setCompany] = useState<string | null>(null);
  const [delayedOnly, setDelayedOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const list = data.offers.filter((o) => (!company || o.company === company) && (!delayedOnly || o.delayed));
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1080 }}>
      <div>
        <h1 style={{ margin: 0 }}>Joining</h1>
        <p className="muted" style={{ margin: 0 }}>
          Accepted campus offers, from the offer letter to the first day. Students update their own; delayed ones come first.
        </p>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {(
          [
            ["Accepted offers", data.totals.accepted],
            ["Joined", data.totals.joined],
            ["Delayed", data.totals.delayed],
            ["Withdrawn by the company", data.totals.revoked],
          ] as [string, number][]
        ).map(([label, n]) => (
          <div key={label} className="card tight">
            <div style={{ fontSize: 26, fontWeight: 700 }}>{n}</div>
            <div className="small muted">{label}</div>
          </div>
        ))}
      </div>
      <section className="card" style={{ padding: 0 }} aria-labelledby="h-companies">
        <h2 id="h-companies" style={{ margin: 0, padding: "14px 16px 0" }}>
          By company
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Accepted</th>
                <th>Letter awaited</th>
                <th>Letter in</th>
                <th>Date given</th>
                <th>Joined</th>
                <th>Not updated</th>
                <th>Delayed</th>
                <th>Next joining</th>
              </tr>
            </thead>
            <tbody>
              {data.companies.map((c) => (
                <tr key={c.company}>
                  <td>
                    <button className="btn ghost small" aria-pressed={company === c.company} onClick={() => setCompany(company === c.company ? null : c.company)}>
                      {c.company}
                    </button>
                  </td>
                  <td>{c.accepted}</td>
                  <td>{c.awaitingLetter}</td>
                  <td>{c.letterReceived}</td>
                  <td>{c.dateGiven}</td>
                  <td>{c.joined}</td>
                  <td>{c.notUpdated}</td>
                  <td>{c.delayed ? <span className="pill bad">{c.delayed}</span> : 0}</td>
                  <td className="small">{c.nextJoining ? fmtDay(c.nextJoining) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="row wrap" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>{company ?? "All companies"}</h2>
        {company && (
          <button className="btn ghost small" onClick={() => setCompany(null)}>
            Show all
          </button>
        )}
        <label className="row small" style={{ gap: 6, marginLeft: "auto" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={delayedOnly} onChange={(e) => setDelayedOnly(e.target.checked)} />
          Delayed only
        </label>
      </div>
      {list.length === 0 ? (
        <div className="card muted">None.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Offer</th>
                  <th>Where it stands</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => {
                  const key = `${o.driveId}-${o.userId}`;
                  return (
                    <tr key={key}>
                      <td>
                        <a href={`/console/students/${o.userId}`}>{o.name}</a>
                        <div className="small muted">{o.rollNo}</div>
                      </td>
                      <td className="small">
                        {o.company}, {o.roleTitle}
                        <div className="muted">{formatLpa(o.ctcRupees)}</div>
                      </td>
                      <td className="small">
                        {editing === key ? (
                          <Edit
                            o={o}
                            onCancel={() => setEditing(null)}
                            onSaved={(b) => {
                              setData(b);
                              setEditing(null);
                            }}
                          />
                        ) : (
                          <div className="row wrap" style={{ gap: 6 }}>
                            <span className={`pill ${o.status ? TONE[o.status] : ""}`}>{o.statusLabel}</span>
                            {o.joiningDate && <span>{fmtDay(o.joiningDate)}</span>}
                            {o.delayed && <span className="pill bad">Delayed</span>}
                            <button className="btn ghost small" onClick={() => setEditing(key)} aria-label={`Update ${o.name}'s ${o.company} offer`}>
                              Update
                            </button>
                            {o.note && <div className="muted" style={{ flexBasis: "100%" }}>{o.note}</div>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
