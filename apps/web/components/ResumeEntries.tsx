"use client";

import { useState, type FormEvent } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Kind = "project" | "internship" | "certification";
const KIND_LABEL: Record<Kind, string> = { internship: "Internship", project: "Project", certification: "Certification" };
interface Entry {
  id: string;
  kind: Kind;
  title: string;
  organisation: string;
  startMonth: string;
  endMonth: string | null;
  period: string;
  description: string;
  link: string | null;
  verification: "none" | "requested" | "verified" | "rejected";
  verificationNote: string | null;
}

const VERIFICATION: Record<Entry["verification"], [string, string] | null> = { none: null, requested: ["Waiting for the college to verify", "warn"], verified: ["Verified by your college", "good"], rejected: ["Not verified yet", "bad"] };

function EntryForm({ initial, onSaved, onCancel }: { initial?: Entry; onSaved: (e: { entries: Entry[] }) => void; onCancel: () => void }) {
  const t = useT();
  const [f, setF] = useState({
    kind: initial?.kind ?? ("internship" as Kind),
    title: initial?.title ?? "",
    organisation: initial?.organisation ?? "",
    startMonth: initial?.startMonth ?? "",
    endMonth: initial?.endMonth ?? "",
    description: initial?.description ?? "",
    link: initial?.link ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cert = f.kind === "certification";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body = { ...f, endMonth: f.endMonth || null, link: f.link || null };
      onSaved(await api<{ entries: Entry[] }>(initial ? `/student/resume/entries/${initial.id}` : "/student/resume/entries", { method: initial ? "PUT" : "POST", body }));
    } catch (err) {
      setMsg(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit} style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <div className="row" role="group" aria-label={t("Kind")}>
        {(["internship", "project", "certification"] as Kind[]).map((k) => (
          <button key={k} type="button" className={`btn small ${f.kind === k ? "primary" : ""}`} aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
            {t(KIND_LABEL[k])}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor="e-title">{t(cert ? "Certification" : f.kind === "internship" ? "Role" : "Project")}</label>
        <input id="e-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} required placeholder={t(cert ? "e.g. Programming in Java" : f.kind === "internship" ? "e.g. Software engineering intern" : "e.g. Canteen ordering app")} />
      </div>
      <div>
        <label htmlFor="e-org">{t(cert ? "Issued by" : f.kind === "internship" ? "Company" : "For (optional)")}</label>
        <input
          id="e-org"
          value={f.organisation}
          onChange={(e) => setF({ ...f, organisation: e.target.value })}
          maxLength={120}
          required={f.kind !== "project"}
          placeholder={cert ? t("e.g. NPTEL (IIT Kharagpur), AWS, Coursera") : f.kind === "project" ? t("e.g. Smart India Hackathon, a course") : undefined}
        />
      </div>
      <div className="row wrap">
        <div>
          <label htmlFor="e-start">{t(cert ? "Earned in" : "From")}</label>
          <input id="e-start" type="month" value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="e-end">{t(cert ? "Valid until (optional)" : "To (leave empty if ongoing)")}</label>
          <input id="e-end" type="month" value={f.endMonth} onChange={(e) => setF({ ...f, endMonth: e.target.value })} />
        </div>
      </div>
      <div>
        <label htmlFor="e-desc">{t(cert ? "Score or grade (optional)" : "What you did")}</label>
        <textarea id="e-desc" className="prose" rows={cert ? 1 : 3} placeholder={cert ? t("e.g. Elite, 82%") : undefined} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={800} />
      </div>
      <div>
        <label htmlFor="e-link">{t(cert ? "Credential link" : "Link (optional)")}</label>
        <input id="e-link" type="url" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} maxLength={300} placeholder="https://" />
      </div>
      {initial?.verification === "verified" && <div className="small">{t("This is verified. Changing it means asking your college to verify it again.")}</div>}
      {msg && <ErrorBox message={msg} />}
      <div className="row">
        <button className="btn primary small" disabled={busy}>
          {busy ? t("Saving...") : t("Save")}
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

/** Internships, projects and certifications on the resume, written by the student; internships and certifications can be verified by the college. */
export function ResumeEntries({ onChange }: { onChange: () => void }) {
  const t = useT();
  const { data, error, loading, reload, setData } = useApi<{ entries: Entry[] }>("/student/resume/entries");
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;

  async function call(path: string, method: "POST" | "DELETE") {
    setMsg(null);
    try {
      setData(await api<{ entries: Entry[] }>(path, { method, body: method === "POST" ? {} : undefined }));
      onChange();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <div className="card stack">
      <div>
        <h2 style={{ margin: 0 }}>{t("Internships, projects and certifications")}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {t("Written by you, so your resume shows them apart from what PlayCode measured. Ask your college to verify an internship (bring the offer letter or completion certificate) or a certification (add its credential link).")}
        </p>
      </div>
      {data.entries.map((e) =>
        editing !== "new" && editing?.id === e.id ? (
          <EntryForm
            key={e.id}
            initial={e}
            onCancel={() => setEditing(null)}
            onSaved={(d) => {
              setData(d);
              setEditing(null);
              onChange();
            }}
          />
        ) : (
          <div key={e.id} className="stack" style={{ gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div className="spread wrap" style={{ gap: 8 }}>
              <div>
                <b>{e.title}</b>
                {e.organisation ? <span>, {e.organisation}</span> : null}
                <div className="small muted">
                  {t(KIND_LABEL[e.kind])} · {e.period}
                </div>
              </div>
              {VERIFICATION[e.verification] && <span className={`pill ${VERIFICATION[e.verification]![1]}`}>{t(VERIFICATION[e.verification]![0])}</span>}
            </div>
            {e.description && <div className="small">{e.description}</div>}
            {e.verification === "rejected" && e.verificationNote && (
              <div className="small" style={{ color: "var(--bad-ink)" }}>
                {t("From your college:")} {e.verificationNote}
              </div>
            )}
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn small" onClick={() => setEditing(e)}>
                {t("Edit")}
              </button>
              {e.kind !== "project" && (e.verification === "none" || e.verification === "rejected") && (
                <button className="btn small" onClick={() => call(`/student/resume/entries/${e.id}/verify`, "POST")}>
                  {t("Ask the college to verify")}
                </button>
              )}
              <button className="btn ghost small" onClick={() => window.confirm(t("Remove this from your resume?")) && call(`/student/resume/entries/${e.id}`, "DELETE")}>
                {t("Remove")}
              </button>
            </div>
          </div>
        ),
      )}
      {editing === "new" ? (
        <EntryForm
          onCancel={() => setEditing(null)}
          onSaved={(d) => {
            setData(d);
            setEditing(null);
            onChange();
          }}
        />
      ) : (
        <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setEditing("new")}>
          {t("Add an internship, project or certification")}
        </button>
      )}
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}
