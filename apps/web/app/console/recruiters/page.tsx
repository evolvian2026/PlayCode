"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { COMPANY_STAGES, formatLpa, INTERACTION_KINDS, type CompanyStage, type InteractionKind } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

type FollowState = "overdue" | "today" | "upcoming";
interface Row {
  id: string;
  name: string;
  sector: string;
  stage: CompanyStage;
  owner: string | null;
  lastContact: string | null;
  followUp: { id: string; on: string; state: FollowState; note: string } | null;
  drives: { drives: number; offers: number; lastDrive: string | null; highestCtc: number | null };
}
interface Detail {
  id: string;
  name: string;
  sector: string;
  website: string | null;
  stage: CompanyStage;
  notes: string;
  ownerId: string | null;
  contacts: { id: string; name: string; designation: string; email: string | null; phone: string | null }[];
  interactions: { id: string; kind: InteractionKind; on: string; note: string; followUpOn: string | null; followUpDone: boolean; state: FollowState | null; by: string | null }[];
  drives: { id: string; roleTitle: string; driveDate: string; ctcRupees: number; status: string; offers: number }[];
}

const STAGE_TONE: Record<CompanyStage, string> = { prospect: "", in_talks: "accent", confirmed: "good", visited: "good", not_interested: "warn" };
const FOLLOW_TONE: Record<FollowState, string> = { overdue: "bad", today: "warn", upcoming: "" };
const FOLLOW_LABEL: Record<FollowState, string> = { overdue: "Overdue", today: "Today", upcoming: "Upcoming" };
const STAGES = Object.entries(COMPANY_STAGES) as [CompanyStage, string][];
const today = () => new Date().toLocaleDateString("en-CA");
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function CompanyForm({ initial, onSaved, onCancel }: { initial: Detail | null; onSaved: (d: Detail) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: initial?.name ?? "", sector: initial?.sector ?? "", website: initial?.website ?? "", stage: initial?.stage ?? ("prospect" as CompanyStage), notes: initial?.notes ?? "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body = { ...f, website: f.website.trim() || null, ownerId: initial?.ownerId ?? null };
      onSaved(await api<Detail>(initial ? `/console/recruiters/${initial.id}` : "/console/recruiters", { method: initial ? "PUT" : "POST", body }));
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={submit} aria-label={initial ? "Edit company" : "Add a company"}>
      <h2 style={{ margin: 0 }}>{initial ? "Edit company" : "Add a company"}</h2>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div>
          <label htmlFor="c-name">Name</label>
          <input id="c-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} required />
        </div>
        <div>
          <label htmlFor="c-sector">Sector</label>
          <input id="c-sector" value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} maxLength={80} placeholder="IT services, product, core..." />
        </div>
        <div>
          <label htmlFor="c-site">Website</label>
          <input id="c-site" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} maxLength={200} placeholder="https://" />
        </div>
        <div>
          <label htmlFor="c-stage">Stage</label>
          <select id="c-stage" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as CompanyStage })}>
            {STAGES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="c-notes">Notes</label>
        <textarea id="c-notes" className="prose" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={4000} placeholder="Who they hire, eligibility they usually ask for, what they liked last time" />
      </div>
      <div className="row">
        <button className="btn primary small" disabled={busy}>
          {initial ? "Save" : "Add company"}
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
    </form>
  );
}

function CompanyView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, reload, setData } = useApi<Detail>(`/console/recruiters/${id}`);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState({ name: "", designation: "", email: "", phone: "" });
  const [log, setLog] = useState({ kind: "call" as InteractionKind, on: today(), note: "", followUpOn: "", stage: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  async function call(path: string, body: object | undefined, method?: string, after?: () => void) {
    setBusy(true);
    setMsg(null);
    try {
      setData(await api<Detail>(`/console/recruiters/${id}${path}`, { body, method }));
      after?.();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Remove ${data!.name} and its contacts and notes?`)) return;
    await api(`/console/recruiters/${id}`, { method: "DELETE" }).catch((e) => setMsg(errorMessage(e)));
    onBack();
  }
  const open = data.interactions.find((i) => i.state);

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← Companies
        </button>
        <h1 style={{ margin: "6px 0 0" }}>{data.name}</h1>
        <div className="small muted">
          <span className={`pill ${STAGE_TONE[data.stage]}`}>{COMPANY_STAGES[data.stage]}</span> {data.sector}
          {data.website && (
            <>
              {" "}
              ·{" "}
              <a href={data.website} target="_blank" rel="noreferrer">
                {data.website.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <CompanyForm
          initial={data}
          onCancel={() => setEditing(false)}
          onSaved={(d) => {
            setData(d);
            setEditing(false);
          }}
        />
      ) : (
        <div className="card stack" style={{ gap: 8 }}>
          <div style={{ whiteSpace: "pre-wrap" }}>{data.notes || <span className="muted">No notes yet.</span>}</div>
          <div className="row">
            <button className="btn small" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn ghost small" onClick={remove}>
              Remove
            </button>
          </div>
        </div>
      )}

      <section className="card stack" aria-labelledby="h-people">
        <h2 id="h-people" style={{ margin: 0 }}>
          People
        </h2>
        {data.contacts.length === 0 && <div className="muted small">Nobody yet. Add the person you talk to.</div>}
        {data.contacts.map((c) => (
          <div key={c.id} className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
            <div>
              <b>{c.name}</b>
              {c.designation && <span className="muted">, {c.designation}</span>}
              <div className="small">
                {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                {c.email && c.phone && " · "}
                {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`}>{c.phone}</a>}
              </div>
            </div>
            <button className="btn ghost small" disabled={busy} onClick={() => call(`/contacts/${c.id}`, undefined, "DELETE")} aria-label={`Remove ${c.name}`}>
              Remove
            </button>
          </div>
        ))}
        <form
          className="row wrap"
          style={{ gap: 6, alignItems: "flex-end" }}
          aria-label="Add a person"
          onSubmit={(e) => {
            e.preventDefault();
            void call("/contacts", { ...contact, email: contact.email || null, phone: contact.phone || null }, undefined, () => setContact({ name: "", designation: "", email: "", phone: "" }));
          }}
        >
          <input aria-label="Name" placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} style={{ maxWidth: 170 }} />
          <input aria-label="Designation" placeholder="Designation" value={contact.designation} onChange={(e) => setContact({ ...contact, designation: e.target.value })} style={{ maxWidth: 170 }} />
          <input aria-label="Email" type="email" placeholder="Email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} style={{ maxWidth: 200 }} />
          <input aria-label="Phone" type="tel" placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} style={{ maxWidth: 150 }} />
          <button className="btn small" disabled={busy || contact.name.trim().length < 2}>
            Add person
          </button>
        </form>
      </section>

      <section className="card stack" aria-labelledby="h-log">
        <h2 id="h-log" style={{ margin: 0 }}>
          Log a conversation
        </h2>
        {open && (
          <div className="small">
            Follow-up {open.state === "overdue" ? "was due" : "due"} {fmtDay(open.followUpOn!)}. Logging this closes it.
          </div>
        )}
        <form
          className="stack"
          aria-label="Log a conversation"
          onSubmit={(e) => {
            e.preventDefault();
            void call("/interactions", { ...log, followUpOn: log.followUpOn || null, stage: log.stage || null }, undefined, () => setLog({ kind: "call", on: today(), note: "", followUpOn: "", stage: "" }));
          }}
        >
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div>
              <label htmlFor="l-kind">What</label>
              <select id="l-kind" value={log.kind} onChange={(e) => setLog({ ...log, kind: e.target.value as InteractionKind })}>
                {(Object.entries(INTERACTION_KINDS) as [InteractionKind, string][]).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="l-on">On</label>
              <input id="l-on" type="date" value={log.on} max={today()} onChange={(e) => setLog({ ...log, on: e.target.value })} />
            </div>
            <div>
              <label htmlFor="l-follow">Follow up on</label>
              <input id="l-follow" type="date" value={log.followUpOn} min={log.on} onChange={(e) => setLog({ ...log, followUpOn: e.target.value })} />
            </div>
            <div>
              <label htmlFor="l-stage">Move to</label>
              <select id="l-stage" value={log.stage} onChange={(e) => setLog({ ...log, stage: e.target.value })}>
                <option value="">Keep: {COMPANY_STAGES[data.stage]}</option>
                {STAGES.filter(([k]) => k !== data.stage).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="l-note">What was said</label>
            <textarea id="l-note" className="prose" rows={2} value={log.note} onChange={(e) => setLog({ ...log, note: e.target.value })} maxLength={2000} />
          </div>
          <div>
            <button className="btn primary small" disabled={busy || log.note.trim().length < 2}>
              Log it
            </button>
          </div>
        </form>
        {msg && <ErrorBox message={msg} />}
        <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 10 }}>
          {data.interactions.map((i) => (
            <li key={i.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <div className="small muted">
                {INTERACTION_KINDS[i.kind]} · {fmtDay(i.on)}
                {i.by ? ` · ${i.by}` : ""}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{i.note}</div>
              {i.followUpOn && (
                <div className="row small" style={{ gap: 8, marginTop: 4 }}>
                  {i.state ? <span className={`pill ${FOLLOW_TONE[i.state]}`}>Follow up {fmtDay(i.followUpOn)}</span> : <span className="muted">Followed up ({fmtDay(i.followUpOn)})</span>}
                  {i.state && (
                    <button className="btn ghost small" disabled={busy} onClick={() => call(`/interactions/${i.id}/done`, {})}>
                      Mark done
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="card stack" aria-labelledby="h-drives">
        <h2 id="h-drives" style={{ margin: 0 }}>
          Drives
        </h2>
        {data.drives.length === 0 ? (
          <div className="muted small">No drives under this name yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Role</th>
                  <th>CTC</th>
                  <th>Offers</th>
                </tr>
              </thead>
              <tbody>
                {data.drives.map((d) => (
                  <tr key={d.id}>
                    <td className="small">{fmtDay(d.driveDate)}</td>
                    <td>
                      <a href={`/console/placements/${d.id}`}>{d.roleTitle}</a>
                    </td>
                    <td className="small">{formatLpa(d.ctcRupees)}</td>
                    <td>{d.offers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Companies() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const { data, error, loading, reload } = useApi<{ recruiters: Row[]; due: Row[]; notListed: number }>(id ? null : "/console/recruiters");
  const [adding, setAdding] = useState(false);
  const [stage, setStage] = useState<CompanyStage | "all">("all");
  const [msg, setMsg] = useState<string | null>(null);
  const go = (to: string) => router.push(to);
  if (id) return <CompanyView key={id} id={id} onBack={() => go("/console/recruiters")} />;

  async function importDrives() {
    setMsg(null);
    try {
      const r = await api<{ added: number }>("/console/recruiters/import", { body: {} });
      setMsg(`Added ${r.added} compan${r.added === 1 ? "y" : "ies"} from past drives.`);
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const link = (r: Row) => (
    <a
      href={`/console/recruiters?id=${r.id}`}
      onClick={(e) => {
        e.preventDefault();
        go(`/console/recruiters?id=${r.id}`);
      }}
    >
      {r.name}
    </a>
  );
  const list = data?.recruiters.filter((r) => stage === "all" || r.stage === stage) ?? [];

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1080 }}>
      <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Companies</h1>
          <p className="muted" style={{ margin: 0 }}>
            Every recruiter the placement cell talks to, the people there, what was said and when to follow up.
          </p>
        </div>
        {!adding && (
          <button className="btn primary small" onClick={() => setAdding(true)}>
            Add a company
          </button>
        )}
      </div>
      {adding && <CompanyForm initial={null} onCancel={() => setAdding(false)} onSaved={(d) => go(`/console/recruiters?id=${d.id}`)} />}
      {data && data.notListed > 0 && (
        <div className="card tight row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
          <span>
            {data.notListed} compan{data.notListed === 1 ? "y has" : "ies have"} held drives here but {data.notListed === 1 ? "isn't" : "aren't"} on the list.
          </span>
          <button className="btn small" onClick={importDrives}>
            Add them
          </button>
        </div>
      )}
      {msg && (
        <div className="card tight small" role="status">
          {msg}
        </div>
      )}
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            {data.due.length > 0 && (
              <section className="card stack" aria-labelledby="h-due" style={{ borderColor: "var(--warn)" }}>
                <h2 id="h-due" style={{ margin: 0 }}>
                  Follow up now
                </h2>
                {data.due.map((r) => (
                  <div key={r.id} className="row wrap" style={{ gap: 8 }}>
                    <span className={`pill ${FOLLOW_TONE[r.followUp!.state]}`}>{r.followUp!.state === "today" ? "Today" : `Since ${fmtDay(r.followUp!.on)}`}</span>
                    <b>{link(r)}</b>
                    <span className="small muted">{r.followUp!.note}</span>
                  </div>
                ))}
              </section>
            )}
            <div className="row wrap" role="group" aria-label="Show stage" style={{ gap: 6 }}>
              {(["all", ...STAGES.map(([k]) => k)] as (CompanyStage | "all")[]).map((k) => {
                const n = k === "all" ? data.recruiters.length : data.recruiters.filter((r) => r.stage === k).length;
                return (
                  <button key={k} className={`btn small ${stage === k ? "primary" : ""}`} aria-pressed={stage === k} onClick={() => setStage(k)}>
                    {k === "all" ? "All" : COMPANY_STAGES[k]} ({n})
                  </button>
                );
              })}
            </div>
            {list.length === 0 ? (
              <div className="card muted">{data.recruiters.length ? "None at this stage." : "No companies yet. Add the first one, or bring in the ones that held drives."}</div>
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Stage</th>
                        <th>Last contact</th>
                        <th>Follow up</th>
                        <th>Drives here</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {link(r)}
                            <div className="small muted">{[r.sector, r.owner].filter(Boolean).join(" · ")}</div>
                          </td>
                          <td>
                            <span className={`pill ${STAGE_TONE[r.stage]}`}>{COMPANY_STAGES[r.stage]}</span>
                          </td>
                          <td className="small">{r.lastContact ? fmtDay(r.lastContact) : "-"}</td>
                          <td className="small">{r.followUp ? `${fmtDay(r.followUp.on)}${r.followUp.state !== "upcoming" ? ` (${FOLLOW_LABEL[r.followUp.state].toLowerCase()})` : ""}` : "-"}</td>
                          <td className="small">
                            {r.drives.drives ? (
                              <>
                                {r.drives.drives} drive{r.drives.drives === 1 ? "" : "s"}, {r.drives.offers} offer{r.drives.offers === 1 ? "" : "s"}
                                <div className="muted">up to {formatLpa(r.drives.highestCtc ?? 0)}</div>
                              </>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

export default function RecruitersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Companies />
    </Suspense>
  );
}
