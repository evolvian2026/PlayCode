"use client";

import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

type Status = "pending" | "published" | "rejected";
interface Item {
  id: string;
  company: string;
  roleTitle: string;
  driveDate: string;
  result: "selected" | "not_selected" | "awaiting";
  difficulty: number;
  rounds: { name: string; description: string }[];
  tips: string;
  author: string;
  rollNo: string | null;
  anonymous: boolean;
  status: Status;
  reviewNote: string | null;
  updatedAt: string;
}

const RESULTS = { selected: "Selected", not_selected: "Not selected", awaiting: "Waiting for result" };
const TABS: [Status, string][] = [
  ["pending", "To review"],
  ["published", "Published"],
  ["rejected", "Sent back"],
];

function Review({ item, onDone }: { item: Item; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(publish: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/console/experiences/${item.id}/review`, { body: { publish, note: publish ? null : note } });
      onDone();
    } catch (e) {
      setMsg(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <article className="card stack" style={{ gap: 8 }}>
      <div className="spread wrap" style={{ gap: 8 }}>
        <div>
          <b>
            {item.company} · {item.roleTitle}
          </b>
          <div className="small muted">
            {item.driveDate} · by {item.author} {item.rollNo ? `(${item.rollNo})` : ""}
            {item.anonymous ? " · posting anonymously" : ""}
          </div>
        </div>
        <div className="small">
          {RESULTS[item.result]} · difficulty {item.difficulty}/5
        </div>
      </div>
      {item.rounds.map((r) => (
        <div key={r.name}>
          <b className="small">{r.name}</b>
          <div style={{ whiteSpace: "pre-wrap" }}>{r.description}</div>
        </div>
      ))}
      {item.tips && (
        <div className="small">
          <b>Tips:</b> {item.tips}
        </div>
      )}
      {item.status === "rejected" && item.reviewNote && <div className="small muted">Sent back: {item.reviewNote}</div>}
      {item.status !== "published" ? (
        <>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">Note for the student, if sending it back</span>
            <textarea className="prose" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Please leave out the interviewer's name and the exact test questions." />
          </label>
          <div className="row wrap">
            <button className="btn primary small" disabled={busy} onClick={() => decide(true)}>
              Publish
            </button>
            <button className="btn small" disabled={busy || !note.trim()} onClick={() => decide(false)}>
              Send back
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">Reason, to unpublish</span>
            <textarea className="prose" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
          <button className="btn ghost small" style={{ alignSelf: "flex-start" }} disabled={busy || !note.trim()} onClick={() => decide(false)}>
            Unpublish and send back
          </button>
        </>
      )}
      {msg && <ErrorBox message={msg} />}
    </article>
  );
}

export default function ConsoleExperiences() {
  const [status, setStatus] = useState<Status>("pending");
  const { data, error, loading, reload } = useApi<{ experiences: Item[] }>(`/console/experiences?status=${status}`);
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <h1 style={{ margin: 0 }}>Interview experiences</h1>
        <p className="muted" style={{ margin: 0 }}>
          Students write about drives they took part in. Read each before it's published: check it names no interviewer and shares nothing the company asked candidates to keep confidential.
        </p>
      </div>
      <div className="row" role="group" aria-label="Show">
        {TABS.map(([key, label]) => (
          <button key={key} className={`btn small ${status === key ? "primary" : ""}`} aria-pressed={status === key} onClick={() => setStatus(key)}>
            {label}
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.experiences.length ? (
        <div className="card muted">{status === "pending" ? "Nothing waiting for review." : "None yet."}</div>
      ) : (
        data.experiences.map((e) => <Review key={`${e.id}-${e.updatedAt}`} item={e} onDone={reload} />)
      )}
    </div>
  );
}
