"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ErrorBox, formatDate, Loading, Stat } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

type Status = "applied" | "shortlisted" | "rejected" | "hired";

interface Detail {
  drive: {
    id: string;
    title: string;
    roleTitle: string;
    status: "open" | "closed";
    inviteCode: string;
    cutoffPct: number | null;
    assessment: { id: string; title: string; openAt: string; closeAt: string; durationMinutes: number; proctorLevel: number };
  };
  candidates: {
    userId: string;
    name: string;
    email: string;
    phone: string | null;
    college: string | null;
    source: string;
    status: Status;
    notes: string | null;
    test: "not_started" | "in_progress" | "submitted";
    attemptId: string | null;
    scorePct: number | null;
    meetsCutoff: boolean | null;
    riskScore: number | null;
    similarityPct: number | null;
  }[];
}

const STATUS_PILL: Record<Status, string> = { applied: "", shortlisted: "accent", rejected: "bad", hired: "good" };
const TEST_LABEL = { not_started: "Not started", in_progress: "Writing", submitted: "Submitted" };

export default function DriveDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Detail>(`/console/drives/${id}`);
  const [filter, setFilter] = useState<"all" | "cutoff" | Status>("all");
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, okMsg?: string) {
    setActionError(null);
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
      void reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const { drive, candidates } = data;
  const link = `${typeof window === "undefined" ? "" : window.location.origin}/apply/${drive.inviteCode}`;
  const shown = candidates.filter((c) => (filter === "all" ? true : filter === "cutoff" ? c.meetsCutoff : c.status === filter));
  const tested = candidates.filter((c) => c.test === "submitted");

  async function exportCsv() {
    const url = await fetchObjectUrl(`/console/drives/${id}/export.csv`);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${drive.title}-candidates.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Link href="/console/drives" className="small">
        <Icon name="back" size={16} /> Hiring drives
      </Link>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>{drive.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {drive.roleTitle} · test {formatDate(drive.assessment.openAt)} to {formatDate(drive.assessment.closeAt)} · {drive.assessment.durationMinutes} min
          </p>
        </div>
        <div className="row">
          <Link href={`/console/tests/${drive.assessment.id}`} className="btn small">
            Live proctoring
          </Link>
          <button className="btn small" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn small" onClick={() => act(() => api(`/console/drives/${id}`, { method: "PUT", body: { status: drive.status === "open" ? "closed" : "open" } }))}>
            {drive.status === "open" ? "Close applications" : "Reopen"}
          </button>
        </div>
      </div>
      <div className="card spread wrap">
        <div>
          <div className="small muted">Apply link{drive.status === "closed" ? " (closed)" : ""}</div>
          <code className="inline-code">{link}</code>
        </div>
        <button className="btn small" onClick={() => void navigator.clipboard?.writeText(link).then(() => setMsg("Link copied"))}>
          Copy link
        </button>
      </div>
      {msg && <span className="pill good">{msg}</span>}
      {actionError && <ErrorBox message={actionError} />}
      <div className="grid">
        <Stat label="Applied" value={candidates.length} />
        <Stat label="Tested" value={tested.length} />
        <Stat label={`Above cut-off (${drive.cutoffPct ?? "-"}%)`} value={candidates.filter((c) => c.meetsCutoff).length} />
        <Stat label="Shortlisted" value={candidates.filter((c) => c.status === "shortlisted" || c.status === "hired").length} />
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {(["all", "cutoff", "applied", "shortlisted", "rejected", "hired"] as const).map((f) => (
          <button key={f} className={`btn small ${filter === f ? "primary" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? "Everyone" : f === "cutoff" ? "Above cut-off" : f[0]!.toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Candidate</th>
              <th>College</th>
              <th>Test</th>
              <th>Score</th>
              <th>Risk</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.userId}>
                <td>
                  <b>{c.name}</b>
                  <div className="muted small">
                    {c.email}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </div>
                </td>
                <td className="small">{c.college ?? "-"}</td>
                <td className="small">{TEST_LABEL[c.test]}</td>
                <td>
                  {c.scorePct === null ? "-" : <b>{c.scorePct}%</b>}
                  {c.meetsCutoff === true && <span className="pill good" style={{ marginLeft: 6 }}>cut-off</span>}
                </td>
                <td>
                  {c.riskScore === null ? "-" : <span className={`pill ${c.riskScore >= 40 ? "bad" : c.riskScore >= 15 ? "warn" : "good"}`}>{c.riskScore}</span>}
                  {c.similarityPct !== null && c.similarityPct >= 70 && <div className="small" style={{ color: "var(--bad-ink)" }}>code {c.similarityPct}% similar</div>}
                </td>
                <td>
                  <select
                    aria-label={`Decision for ${c.name}`}
                    value={c.status}
                    onChange={(e) => act(() => api(`/console/drives/${id}/candidates/${c.userId}`, { method: "PUT", body: { status: e.target.value } }))}
                    style={{ width: 140 }}
                  >
                    <option value="applied">Applied</option>
                    <option value="shortlisted">Shortlisted</option>
                    <option value="rejected">Rejected</option>
                    <option value="hired">Hired</option>
                  </select>
                  {c.status !== "applied" && <span className={`pill ${STATUS_PILL[c.status]}`} style={{ marginLeft: 6 }}>{c.status}</span>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center">
                  No candidates here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Add candidates from a list</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Paste name,email rows (for example, from a college placement cell). Each candidate gets a starting password to share with them.
        </p>
        <textarea rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"name,email\nAsha Rao,asha@example.com"} />
        <button
          className="btn small"
          style={{ alignSelf: "flex-start" }}
          disabled={!csv.trim()}
          onClick={() =>
            act(async () => {
              const r = await api<{ created: { email: string; password: string }[]; skipped: unknown[] }>(`/console/drives/${id}/candidates/import`, { body: { csv } });
              setCsv(r.created.map((c) => `${c.email},${c.password}`).join("\n"));
              setMsg(`${r.created.length} added, ${r.skipped.length} skipped. The box now shows their starting passwords.`);
            })
          }
        >
          Add candidates
        </button>
      </div>
    </div>
  );
}
