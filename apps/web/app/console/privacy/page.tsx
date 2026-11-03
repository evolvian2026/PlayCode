"use client";

import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

interface ErasureRequest {
  id: string;
  userId: string;
  name: string;
  email: string;
  rollNo: string | null;
  reason: string | null;
  status: "pending" | "completed" | "rejected" | "cancelled";
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const STATUS: Record<ErasureRequest["status"], { label: string; tone: string }> = {
  pending: { label: "Waiting", tone: "warn" },
  completed: { label: "Erased", tone: "good" },
  rejected: { label: "Declined", tone: "bad" },
  cancelled: { label: "Withdrawn", tone: "" },
};

function RequestRow({ r, onDone }: { r: ErasureRequest; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(decision: "erase" | "reject") {
    if (decision === "erase" && !window.confirm(`Erase ${r.name}'s account and all their data? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/console/privacy/requests/${r.id}`, { body: { decision, note: note.trim() || undefined } });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function exportData() {
    try {
      const url = await fetchObjectUrl(`/console/students/${r.userId}/export`);
      const a = document.createElement("a");
      a.href = url;
      a.download = `student-${r.rollNo ?? r.userId}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="spread">
        <div>
          <strong>{r.name}</strong> <span className="muted small">{r.status === "completed" ? "" : `${r.email}${r.rollNo ? ` · ${r.rollNo}` : ""}`}</span>
        </div>
        <span className={`pill ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
      </div>
      <div className="small muted">
        Requested {new Date(r.createdAt).toLocaleString()}
        {r.resolvedAt && ` · handled ${new Date(r.resolvedAt).toLocaleString()}`}
      </div>
      {r.reason && <div className="small">&ldquo;{r.reason}&rdquo;</div>}
      {r.resolution && <div className="small muted">Note: {r.resolution}</div>}
      {r.status === "pending" && (
        <>
          <input aria-label="Note to the student" placeholder="Note to the student (needed to decline)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <div className="row wrap">
            <button className="btn small danger" disabled={busy} onClick={() => act("erase")}>
              Erase data
            </button>
            <button className="btn small" disabled={busy} onClick={() => act("reject")}>
              Decline
            </button>
            <button className="btn small ghost" disabled={busy} onClick={exportData}>
              Download their data
            </button>
          </div>
        </>
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}

export default function PrivacyRequests() {
  const { data, error, loading, reload } = useApi<{ requests: ErasureRequest[] }>("/console/privacy/requests");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const pending = data.requests.filter((r) => r.status === "pending").length;

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
      <h1 style={{ margin: 0 }}>Privacy requests</h1>
      <p className="muted" style={{ margin: 0 }}>
        Students can download their own data and ask for their account to be deleted from their profile page. Erasing removes their practice history, test
        attempts with proctoring evidence, certificates and hiring-drive records, and anonymises the account. Results already in your reports keep their
        totals but no longer name the student.
      </p>
      {data.requests.length === 0 ? (
        <div className="card muted">No requests yet.</div>
      ) : (
        <>
          <div className="small muted">{pending ? `${pending} waiting for a decision` : "Nothing waiting"}</div>
          {data.requests.map((r) => (
            <RequestRow key={r.id} r={r} onDone={reload} />
          ))}
        </>
      )}
    </div>
  );
}
