"use client";

import { useState } from "react";
import { signOut } from "@/components/Auth";
import { ErrorBox } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

interface PrivacyState {
  noticeVersion: string;
  noticeAccepted: boolean;
  history: { purpose: "privacy_notice" | "whatsapp"; granted: boolean; noticeVersion: string; source: string; at: string }[];
  erasure: { status: "pending" | "completed" | "rejected" | "cancelled"; reason: string | null; resolution: string | null; createdAt: string } | null;
  canRequestErasure: boolean;
}

const PURPOSE: Record<PrivacyState["history"][number]["purpose"], string> = {
  privacy_notice: "Privacy notice",
  whatsapp: "WhatsApp reminders",
};

/** Consent, a copy of your data, and deletion: the rights a data principal has under the DPDP Act. */
export function PrivacyCard() {
  const { data, error, reload, setData } = useApi<PrivacyState>("/privacy");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const download = () =>
    run(async () => {
      const url = await fetchObjectUrl("/privacy/export");
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-playcode-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMsg("Your data has been downloaded.");
    });

  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return null;
  const pending = data.erasure?.status === "pending";

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Privacy and your data</h2>
      {!data.noticeAccepted && (
        <div className="stack" style={{ gap: 8, padding: 12, borderRadius: 10, background: "var(--accent-soft)" }}>
          <div className="small">
            Your institution uses PlayCode to track practice and run tests. We keep your answers, scores and activity to show your progress to you and your trainers.
            Tests may record tab switches and webcam snapshots, kept only for the review window. You can download or delete your data at any time.
          </div>
          <button className="btn small primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => run(async () => setData({ ...data, ...(await api<PrivacyState>("/privacy/notice", { body: { accept: true } })) }))}>
            I have read this
          </button>
        </div>
      )}
      <div className="row wrap">
        <button className="btn small" disabled={busy} onClick={download}>
          Download my data
        </button>
        {data.canRequestErasure && !pending && (
          <button className="btn small ghost" disabled={busy} onClick={() => setAsking(true)}>
            Delete my account...
          </button>
        )}
      </div>
      {asking && !pending && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="small">
            Your institution will review the request. Once approved, your practice history, test attempts, certificates and account are erased and cannot be recovered.
          </div>
          <input aria-label="Reason (optional)" placeholder="Reason (optional)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          <div className="row">
            <button
              className="btn small danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/privacy/erasure", { body: { reason: reason.trim() || undefined } });
                  setAsking(false);
                  reload();
                })
              }
            >
              Request deletion
            </button>
            <button className="btn small ghost" onClick={() => setAsking(false)}>
              Keep my account
            </button>
          </div>
        </div>
      )}
      {data.erasure && data.erasure.status !== "cancelled" && (
        <div className="small">
          {pending && (
            <span className="row wrap" style={{ gap: 8 }}>
              <span className="pill warn">Deletion requested {new Date(data.erasure.createdAt).toLocaleDateString()}</span>
              <button className="btn ghost small" disabled={busy} onClick={() => run(async () => { await api("/privacy/erasure/cancel", { body: {} }); reload(); })}>
                Cancel request
              </button>
            </span>
          )}
          {data.erasure.status === "rejected" && (
            <span className="muted">
              Your deletion request was declined: {data.erasure.resolution}
            </span>
          )}
          {data.erasure.status === "completed" && (
            <button className="btn ghost small" onClick={signOut}>
              Your data has been erased. Sign out
            </button>
          )}
        </div>
      )}
      {actionError && <ErrorBox message={actionError} />}
      {msg && <span className="small muted">{msg}</span>}
      {data.history.length > 0 && (
        <details>
          <summary className="small muted">Consent history</summary>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {data.history.map((h, i) => (
              <li key={i}>
                {PURPOSE[h.purpose]}: {h.granted ? "agreed" : "withdrawn"} on {new Date(h.at).toLocaleString()} (notice {h.noticeVersion})
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
