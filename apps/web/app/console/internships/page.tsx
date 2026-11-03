"use client";

import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

type Status = "requested" | "verified" | "rejected";
type Kind = "internship" | "certification";
interface Entry {
  id: string;
  kind: Kind;
  title: string;
  organisation: string;
  period: string;
  description: string;
  link: string | null;
  verificationNote: string | null;
  student: { id: string; name: string; rollNo: string | null };
}

interface Summary {
  certifications: number;
  students: number;
  byIssuer: { issuer: string; certifications: number; students: number }[];
}

const TABS: [Status, string][] = [
  ["requested", "To verify"],
  ["verified", "Verified"],
  ["rejected", "Sent back"],
];

function Review({ entry, status, onDone }: { entry: Entry; status: Status; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function decide(verify: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/console/internships/${entry.id}/review`, { body: { verify, note: verify ? null : note } });
      onDone();
    } catch (e) {
      setMsg(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <article className="card stack" style={{ gap: 6 }}>
      <div>
        <b>
          {entry.title}, {entry.organisation}
        </b>{" "}
        <span className="pill">{entry.kind === "certification" ? "Certification" : "Internship"}</span>
        <div className="small muted">
          {entry.student.name} {entry.student.rollNo ? `(${entry.student.rollNo})` : ""} · {entry.period}
          {entry.link ? (
            <>
              {" · "}
              <a href={entry.link} target="_blank" rel="noopener noreferrer">
                {entry.kind === "certification" ? "credential" : "link"}
              </a>
            </>
          ) : null}
        </div>
      </div>
      {entry.description && <div className="small">{entry.description}</div>}
      {status === "rejected" && entry.verificationNote && <div className="small muted">Sent back: {entry.verificationNote}</div>}
      {status === "requested" && (
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn primary small" disabled={busy} onClick={() => decide(true)}>
            {entry.kind === "certification" ? "Verified: I've checked the credential" : "Verified: I've seen the letter or certificate"}
          </button>
          <input aria-label={`What you need from ${entry.student.name}`} placeholder="What you need to see, to send it back" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={{ maxWidth: 340 }} />
          <button className="btn small" disabled={busy || !note.trim()} onClick={() => decide(false)}>
            Send back
          </button>
        </div>
      )}
      {msg && <ErrorBox message={msg} />}
    </article>
  );
}

export default function InternshipsPage() {
  const [tab, setTab] = useState<Status>("requested");
  const [kind, setKind] = useState<Kind | "">("");
  const { data, error, loading, reload } = useApi<{ entries: Entry[]; total: number; certifications: Summary }>(`/console/internships?status=${tab}${kind ? `&kind=${kind}` : ""}`);
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <h1 style={{ margin: 0 }}>Internships and certifications</h1>
        <p className="muted" style={{ margin: 0 }}>
          Internships and certifications students added to their resume and asked the college to verify. For an internship, check the offer letter, completion certificate or the company&apos;s email; for a certification, open its credential link and check the name and course. Verified entries show as verified by your institution on resumes and public profiles, and count in the accreditation report.
        </p>
      </div>
      {data && data.certifications.certifications > 0 && (
        <section className="card stack" style={{ gap: 6 }} aria-labelledby="h-certs">
          <h2 id="h-certs" style={{ margin: 0, fontSize: 16 }}>
            Certifications earned: {data.certifications.certifications}, by {data.certifications.students} students
          </h2>
          <div className="row wrap" style={{ gap: 6 }}>
            {data.certifications.byIssuer.map((g) => (
              <span key={g.issuer} className="pill">
                {g.issuer}: {g.students} {g.students === 1 ? "student" : "students"}
              </span>
            ))}
          </div>
        </section>
      )}
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="row" role="group" aria-label="Show">
          {TABS.map(([k, label]) => (
            <button key={k} className={`btn small ${tab === k ? "primary" : ""}`} aria-pressed={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="row" role="group" aria-label="Kind">
          {([["", "Both"], ["internship", "Internships"], ["certification", "Certifications"]] as [Kind | "", string][]).map(([k, label]) => (
            <button key={k} className={`btn small ${kind === k ? "primary" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.entries.length ? (
        <div className="card muted">{tab === "requested" ? "Nothing waiting to be verified." : "None yet."}</div>
      ) : (
        data.entries.map((e) => <Review key={`${tab}-${kind}-${e.id}`} entry={e} status={tab} onDone={reload} />)
      )}
    </div>
  );
}
