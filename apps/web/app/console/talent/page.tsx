"use client";

import { useState, type FormEvent } from "react";
import { Bar, ErrorBox, formatDate, Loading, masteryTone } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

type Track = "service" | "product";

interface Candidate {
  userId: string;
  name: string;
  institution: string;
  program: string | null;
  graduationYear: number | null;
  headline: string;
  readiness: { service: number; product: number };
  cgpa: number | null;
  masteredSkills: number;
  locations: string[];
  invite: { id: string; status: "pending" | "accepted" | "declined" | "expired" } | null;
}

interface Results {
  total: number;
  nextCursor: number | null;
  candidates: Candidate[];
}

interface Profile {
  userId: string;
  name: string;
  headline: string;
  about: string;
  institution: string;
  program: string | null;
  graduationYear: number | null;
  readiness: { id: string; name: string; score: number }[];
  skills: { name: string; mastery: number }[];
  certificates: { title: string; scorePct: number; verifyUrl: string }[];
  practice: { questionsSolved: number; codingProblemsSolved: number; sqlProblemsSolved: number; activeDays90: number; longestStreak: number };
  mockInterview: { track: string; overall: number } | null;
  academic: { cgpa: number | null } | null;
  links: { github?: string; linkedin?: string; portfolio?: string };
  lookingFor: { locations?: string[] };
}

interface Invites {
  left: number;
  invites: {
    id: string;
    userId: string;
    name: string;
    institution: string;
    roleTitle: string;
    drive: string | null;
    status: string;
    createdAt: string;
    contact: { email: string; phone: string | null } | null;
  }[];
}

const STATUS: Record<string, string> = { pending: "Invited", accepted: "Accepted", declined: "Declined", expired: "Lapsed" };

function InviteForm({ candidate, onSent }: { candidate: { userId: string; name: string }; onSent: () => void }) {
  const drives = useApi<{ drives: { id: string; title: string; status: string }[] }>("/console/drives");
  const [roleTitle, setRoleTitle] = useState("");
  const [message, setMessage] = useState("");
  const [driveId, setDriveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/console/talent/invites", { body: { userId: candidate.userId, roleTitle, message, driveId: driveId || null } });
      onSent();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={send}>
      <h3 style={{ margin: 0 }}>Invite {candidate.name}</h3>
      <div>
        <label htmlFor="inv-role">Role</label>
        <input id="inv-role" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} required minLength={2} maxLength={120} placeholder="Graduate Engineer Trainee" />
      </div>
      <div>
        <label htmlFor="inv-drive">Drive to apply to (optional)</label>
        <select id="inv-drive" value={driveId} onChange={(e) => setDriveId(e.target.value)}>
          <option value="">No drive: we'll contact them</option>
          {(drives.data?.drives ?? [])
            .filter((d) => d.status === "open")
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
        </select>
      </div>
      <div>
        <label htmlFor="inv-msg">Message</label>
        <textarea id="inv-msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} required minLength={10} maxLength={1000} placeholder="What the role is, where, and why their record stood out." />
      </div>
      {error && <ErrorBox message={error} />}
      <div className="small muted">They see your company name, the role and your message. You get their email and phone only if they accept.</div>
      <button className="btn primary" disabled={busy} style={{ alignSelf: "flex-start" }}>
        {busy ? "Sending..." : "Send invitation"}
      </button>
    </form>
  );
}

function CandidatePanel({ userId, invite, onClose, onSent }: { userId: string; invite: Candidate["invite"]; onClose: () => void; onSent: () => void }) {
  const { data, error, loading, reload } = useApi<Profile>(`/console/talent/candidates/${userId}`);
  const [inviting, setInviting] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const canInvite = !invite || invite.status === "expired";
  return (
    <section className="card stack" aria-label={`Profile of ${data.name}`}>
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0 }}>{data.name}</h2>
          <div className="small">{data.headline}</div>
          <div className="small muted">
            {data.institution}
            {data.program ? ` · ${data.program}` : ""}
            {data.graduationYear ? ` · graduates ${data.graduationYear}` : ""}
            {data.academic?.cgpa != null ? ` · CGPA ${data.academic.cgpa}` : ""}
          </div>
        </div>
        <button className="btn ghost small" onClick={onClose}>
          Close
        </button>
      </div>
      {data.about && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{data.about}</p>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {data.readiness.map((r) => (
          <div key={r.id}>
            <div className="spread small">
              <span>{r.name}</span>
              <b>{r.score}</b>
            </div>
            <Bar value={r.score} tone={masteryTone(r.score)} label={`${r.name} readiness`} />
          </div>
        ))}
      </div>
      <div className="small">
        <b>Mastered skills:</b> {data.skills.length ? data.skills.map((s) => `${s.name} (${s.mastery}%)`).join(", ") : "none yet"}
      </div>
      <div className="small">
        <b>Practice:</b> {data.practice.questionsSolved} questions, {data.practice.codingProblemsSolved} coding and {data.practice.sqlProblemsSolved} SQL problems solved; active {data.practice.activeDays90} of the last 90
        days; longest streak {data.practice.longestStreak} days.
      </div>
      {data.mockInterview && (
        <div className="small">
          <b>Latest mock interview:</b> {data.mockInterview.overall}/5 ({data.mockInterview.track} company)
        </div>
      )}
      {data.certificates.length > 0 && (
        <div className="small">
          <b>Certificates:</b>{" "}
          {data.certificates.map((c, i) => (
            <span key={c.verifyUrl}>
              {i > 0 && ", "}
              <a href={c.verifyUrl} target="_blank" rel="noreferrer">
                {c.title} ({c.scorePct}%)
              </a>
            </span>
          ))}
        </div>
      )}
      {data.lookingFor.locations?.length ? <div className="small muted">Prefers: {data.lookingFor.locations.join(", ")}</div> : null}
      <div className="small muted">Measured by PlayCode from the student&apos;s own practice. Contact details are shared only if they accept an invitation.</div>
      {canInvite ? (
        inviting ? (
          <InviteForm
            candidate={data}
            onSent={() => {
              setInviting(false);
              onSent();
            }}
          />
        ) : (
          <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => setInviting(true)}>
            Invite to apply
          </button>
        )
      ) : (
        <span className="pill" style={{ alignSelf: "flex-start" }}>
          {STATUS[invite!.status]}
        </span>
      )}
    </section>
  );
}

function InviteList() {
  const { data, error, loading, reload } = useApi<Invites>("/console/talent/invites");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  return (
    <div className="card stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Invitations</h2>
        <span className="small muted">{data.left} left today</span>
      </div>
      {data.invites.length === 0 ? (
        <div className="muted small">No invitations yet. Search the pool and invite students whose record fits the role.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Role</th>
                <th>Sent</th>
                <th>Status</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {data.invites.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.name}
                    <div className="small muted">{i.institution}</div>
                  </td>
                  <td className="small">
                    {i.roleTitle}
                    {i.drive && <div className="muted">{i.drive}</div>}
                  </td>
                  <td className="small">{formatDate(i.createdAt)}</td>
                  <td>
                    <span className={`pill ${i.status === "accepted" ? "good" : ""}`}>{STATUS[i.status]}</span>
                  </td>
                  <td className="small">
                    {i.contact ? (
                      <>
                        <a href={`mailto:${i.contact.email}`}>{i.contact.email}</a>
                        {i.contact.phone && <div>{i.contact.phone}</div>}
                      </>
                    ) : (
                      <span className="muted">Shared if they accept</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TalentPage() {
  const skills = useApi<{ skills: { id: string; name: string; topicName: string }[] }>("/console/skills");
  const [f, setF] = useState({ track: "service" as Track, minReadiness: 40, graduationYear: "", location: "", skill: "" });
  const [query, setQuery] = useState(() => new URLSearchParams({ track: "service", minReadiness: "40" }).toString());
  const results = useApi<Results>(`/console/talent/search?${query}`);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"search" | "invites">("search");

  function search(e: FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams({ track: f.track, minReadiness: String(f.minReadiness) });
    if (f.graduationYear) p.set("graduationYear", f.graduationYear);
    if (f.location.trim()) p.set("location", f.location.trim());
    if (f.skill) p.set("skills", f.skill);
    setOpen(null);
    setQuery(p.toString());
  }

  const selected = results.data?.candidates.find((c) => c.userId === open);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1 style={{ margin: 0 }}>Talent pool</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Students at colleges on PlayCode who chose to be found, ranked by readiness measured from their own practice. Invite the ones who fit; you get their contact details when they accept.
        </p>
      </div>
      <div className="row" role="tablist" aria-label="Talent pool">
        {(["search", "invites"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn small ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>
            {k === "search" ? "Search" : "Invitations"}
          </button>
        ))}
      </div>
      {tab === "invites" ? (
        <InviteList />
      ) : (
        <>
          <form className="card row wrap" style={{ alignItems: "flex-end" }} onSubmit={search}>
            <div>
              <label htmlFor="t-track">Hiring for</label>
              <select id="t-track" value={f.track} onChange={(e) => setF({ ...f, track: e.target.value as Track })}>
                <option value="service">Service company roles</option>
                <option value="product">Product company roles</option>
              </select>
            </div>
            <div style={{ width: 130 }}>
              <label htmlFor="t-min">Min. readiness</label>
              <input id="t-min" type="number" min={0} max={100} value={f.minReadiness} onChange={(e) => setF({ ...f, minReadiness: Number(e.target.value) })} />
            </div>
            <div style={{ width: 130 }}>
              <label htmlFor="t-year">Graduating</label>
              <input id="t-year" type="number" min={2020} max={2035} placeholder="Any year" value={f.graduationYear} onChange={(e) => setF({ ...f, graduationYear: e.target.value })} />
            </div>
            <div style={{ width: 160 }}>
              <label htmlFor="t-loc">Location</label>
              <input id="t-loc" placeholder="Any" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
            </div>
            <div style={{ minWidth: 200 }}>
              <label htmlFor="t-skill">Must have mastered</label>
              <select id="t-skill" value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })}>
                <option value="">Any skill</option>
                {(skills.data?.skills ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.topicName}: {s.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn primary">Search</button>
          </form>
          {results.error ? (
            <ErrorBox message={results.error.message} onRetry={results.reload} />
          ) : !results.data ? (
            <Loading />
          ) : (
            <div className="grid" style={{ gridTemplateColumns: open ? "minmax(0, 1fr) minmax(0, 1.2fr)" : "1fr", alignItems: "start" }}>
              <div className="card stack" style={{ gap: 8 }}>
                <div className="small muted" aria-live="polite">
                  {results.data.total} student{results.data.total === 1 ? "" : "s"} match
                </div>
                {results.data.candidates.length === 0 && <div className="muted">No one matches yet. Try a lower readiness or fewer filters.</div>}
                {results.data.candidates.map((c) => (
                  <button
                    key={c.userId}
                    className={`card tight spread ${open === c.userId ? "selected" : ""}`}
                    style={{ textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", borderColor: open === c.userId ? "var(--accent)" : undefined }}
                    aria-pressed={open === c.userId}
                    onClick={() => setOpen(c.userId)}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      <span className="small muted" style={{ display: "block" }}>
                        {c.institution}
                        {c.graduationYear ? ` · ${c.graduationYear}` : ""}
                        {c.cgpa != null ? ` · CGPA ${c.cgpa}` : ""} · {c.masteredSkills} skills mastered
                      </span>
                      {c.headline && <span className="small" style={{ display: "block" }}>{c.headline}</span>}
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span className="kpi" style={{ fontSize: 22 }}>{c.readiness[f.track]}</span>
                      <span className="small muted" style={{ display: "block" }}>readiness</span>
                      {c.invite && <span className="pill small">{STATUS[c.invite.status]}</span>}
                    </span>
                  </button>
                ))}
              </div>
              {open && selected && (
                <CandidatePanel
                  key={open}
                  userId={open}
                  invite={selected.invite}
                  onClose={() => setOpen(null)}
                  onSent={() => {
                    void results.reload();
                  }}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
