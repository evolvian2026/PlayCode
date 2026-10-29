"use client";

import { useState, type ChangeEvent } from "react";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

type Status = "pending" | "verified" | "rejected";
interface Request {
  id: string;
  title: string;
  instructions: string;
  dueOn: string;
  closed: boolean;
  file: { fileName: string; sizeBytes: number; status: Status; reviewNote: string | null; submittedAt: string } | null;
}
interface Mine {
  requests: Request[];
  todo: number;
}

const STATUS: Record<Status, [string, string]> = { pending: ["Waiting to be checked", "warn"], verified: ["Verified", "good"], rejected: ["Upload again", "bad"] };
const ACCEPT = Object.keys(DOCUMENT_TYPES).join(",");

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

function UploadButton({ request, onDone }: { request: Request; onDone: (m: Mine) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    if (file.size > MAX_DOCUMENT_BYTES) {
      setMsg(t("The file is larger than 5 MB. Scan it at a lower resolution or upload a photo."));
      return;
    }
    setBusy(true);
    try {
      onDone(await api<Mine>(`/student/documents/${request.id}`, { method: "PUT", body: { fileName: file.name, data: await readBase64(file) } }));
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className={`btn small ${request.file ? "" : "primary"}`} style={{ alignSelf: "flex-start", cursor: busy ? "wait" : "pointer" }}>
        {busy ? t("Uploading...") : t(request.file ? "Upload a new file" : "Upload a file")}
        <input type="file" accept={ACCEPT} onChange={pick} disabled={busy} className="sr-only" />
      </label>
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

export default function DocumentsPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload, setData } = useApi<Mine>("/student/documents");
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" });

  async function view(id: string) {
    setMsg(null);
    try {
      window.open(await fetchObjectUrl(`/student/documents/${id}/file`), "_blank", "noopener");
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: 0 }}>{t("Documents")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Files your placement cell has asked for. A PDF, or a clear photo (JPG or PNG), up to 5 MB.")}
        </p>
      </div>
      {msg && <ErrorBox message={msg} />}
      {data.requests.length === 0 ? (
        <div className="card muted">{t("Nothing to upload right now.")}</div>
      ) : (
        data.requests.map((r) => {
          const status = r.file ? STATUS[r.file.status] : null;
          return (
            <div key={r.id} className="card stack" style={{ gap: 8, borderColor: !r.closed && (!r.file || r.file.status === "rejected") ? "var(--warn)" : undefined }}>
              <div className="spread wrap" style={{ gap: 8 }}>
                <div>
                  <b>{r.title}</b>
                  <div className="small muted">{r.closed ? t("Closed") : t("Upload by {date}", { date: fmt(r.dueOn) })}</div>
                </div>
                {status ? <span className={`pill ${status[1]}`}>{t(status[0])}</span> : <span className="pill">{t("Not uploaded")}</span>}
              </div>
              {r.instructions && <div className="small" style={{ whiteSpace: "pre-wrap" }}>{r.instructions}</div>}
              {r.file?.status === "rejected" && r.file.reviewNote && (
                <div className="small" style={{ color: "var(--bad-ink)" }}>
                  {t("From the placement cell:")} {r.file.reviewNote}
                </div>
              )}
              {r.file && (
                <div className="row wrap small" style={{ gap: 8 }}>
                  <button className="btn ghost small" onClick={() => view(r.id)}>
                    {r.file.fileName}
                  </button>
                  <span className="muted">{Math.max(1, Math.round(r.file.sizeBytes / 1024))} KB</span>
                </div>
              )}
              {!r.closed && r.file?.status !== "verified" && <UploadButton request={r} onDone={setData} />}
            </div>
          );
        })
      )}
    </div>
  );
}
