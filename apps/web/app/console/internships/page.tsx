"use client";

import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

type Status = "requested" | "verified" | "rejected";
interface Entry {
  id: string;
  title: string;
  organisation: string;
  period: string;
  description: string;
  link: string | null;
  verificationNote: string | null;
  student: { id: string; name: string; rollNo: string | null };
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
        </b>
        <div className="small muted">
          {entry.student.name} {entry.student.rollNo ? `(${entry.student.rollNo})` : ""} · {entry.period}
          {entry.link ? (
            <>
              {" · "}
              <a href={entry.link} target="_blank" rel="noopener noreferrer">
                link
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
            Verified: I&apos;ve seen the letter or certificate
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
  const { data, error, loading, reload } = useApi<{ entries: Entry[]; total: number }>(`/console/internships?status=${tab}`);
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <h1 style={{ margin: 0 }}>Internships</h1>
        <p className="muted" style={{ margin: 0 }}>
          Internships students added to their resume and asked the college to verify. Check the offer letter, completion certificate or the company&apos;s email first: verified internships show as verified by your institution on resumes and public profiles, and count in the accreditation report.
        </p>
      </div>
      <div className="row" role="group" aria-label="Show">
        {TABS.map(([k, label]) => (
          <button key={k} className={`btn small ${tab === k ? "primary" : ""}`} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.entries.length ? (
        <div className="card muted">{tab === "requested" ? "Nothing waiting to be verified." : "None yet."}</div>
      ) : (
        data.entries.map((e) => <Review key={`${tab}-${e.id}`} entry={e} status={tab} onDone={reload} />)
      )}
    </div>
  );
}
