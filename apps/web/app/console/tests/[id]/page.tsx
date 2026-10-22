"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/components/Auth";
import { Icon } from "@/components/Icon";
import { ErrorBox, formatDate, Loading, Stat, timeAgo } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

interface MonitorRow {
  userId: string;
  name: string;
  rollNo: string | null;
  attemptId: string | null;
  status: "not_started" | "in_progress" | "submitted" | "auto_submitted";
  answered: number;
  total: number;
  timeLeftMs: number | null;
  lastSeenAt: string | null;
  integrity: Record<string, number>;
  riskScore: number;
  similarityPct: number;
  score: number | null;
  maxScore: number | null;
  latestSnapshot: { id: string; at: string } | null;
}

interface Monitor {
  assessment: { id: string; title: string; proctorLevel: 1 | 2 | 3; openAt: string; closeAt: string; durationMinutes: number; releasePolicy: string; resultsReleasedAt: string | null; sections: { title: string; pick: number; marks: number; negative: number }[] };
  counts: { not_started: number; in_progress: number; submitted: number };
  students: MonitorRow[];
}

interface Results {
  summary: { submitted: number; average: number | null; highest: number | null; maxScore: number | null; flagged: number };
  rows: { attemptId: string; name: string; rollNo: string | null; status: string; score: number; maxScore: number; sections: { title: string; score: number; max: number }[]; riskScore: number; similarityPct: number; rank: number }[];
  plagiarism: { questionId: string; a: { attemptId: string; name: string }; b: { attemptId: string; name: string }; similarityPct: number; flagged: boolean }[];
}

interface AttemptDetail {
  id: string;
  student: { name: string; rollNo: string | null };
  status: string;
  startedAt: string;
  deadline: string;
  extraMs: number;
  riskScore: number;
  similarityPct: number;
  score: number | null;
  maxScore: number | null;
  events: { type: string; detail: string | null; at: string }[];
  snapshots: { id: string; at: string; review: { faces: number; phone: boolean; otherPerson: boolean; note: string } | { error: string } | null }[];
  similarTo: { questionId: string; attemptId: string; similarityPct: number }[];
}

const EVENT_LABELS: Record<string, string> = {
  tab_hidden: "Switched tab",
  focus_lost: "Left window",
  fullscreen_exit: "Left full screen",
  paste: "Pasted",
  copy: "Copied",
  device_changed: "Another device",
  multiple_faces: "Several faces",
  no_face: "No face",
  phone_visible: "Phone visible",
  other_person: "Someone else",
};

type SnapshotRow = AttemptDetail["snapshots"][number];

/** What the level-3 AI review flagged on a snapshot, if anything. */
function snapshotFlags(s: SnapshotRow): string[] {
  const r = s.review;
  if (!r || "error" in r) return [];
  const flags: string[] = [];
  if (r.faces === 0) flags.push("No face");
  if (r.faces > 1) flags.push(`${r.faces} faces`);
  if (r.phone) flags.push("Phone");
  if (r.otherPerson && r.faces <= 1) flags.push("Someone else");
  return flags;
}

const riskPill = (r: number) => <span className={`pill ${r >= 40 ? "bad" : r >= 15 ? "warn" : "good"}`}>{r}</span>;
const STATUS: Record<MonitorRow["status"], [string, string]> = {
  not_started: ["Not started", ""],
  in_progress: ["Writing", "accent"],
  submitted: ["Submitted", "good"],
  auto_submitted: ["Time up", "good"],
};

function Snapshot({ attemptId, snapshotId, size = 96 }: { attemptId: string; snapshotId: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    fetchObjectUrl(`/console/attempts/${attemptId}/snapshots/${snapshotId}`)
      .then((u) => {
        revoke = u;
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [attemptId, snapshotId]);
  return url ? <img src={url} alt="Webcam snapshot" width={size} style={{ borderRadius: 8, display: "block" }} /> : <span className="muted small">loading</span>;
}

function AttemptPanel({ attemptId, onClose, onChanged }: { attemptId: string; onClose: () => void; onChanged: () => void }) {
  const { data, reload } = useApi<AttemptDetail>(`/console/attempts/${attemptId}`);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (path: string, body: unknown = {}) => {
    try {
      await api(`/console/attempts/${attemptId}/${path}`, { body });
      setMsg(null);
      void reload();
      onChanged();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  if (!data) return <div className="card"><Loading /></div>;
  return (
    <div className="card stack" aria-label={`Attempt by ${data.student.name}`}>
      <div className="spread">
        <h2 style={{ margin: 0 }}>{data.student.name}</h2>
        <button className="btn ghost small" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="row wrap small">
        <span>Risk {riskPill(data.riskScore)}</span>
        <span>Started {formatDate(data.startedAt)}</span>
        <span>Deadline {formatDate(data.deadline)}</span>
        {data.extraMs > 0 && <span className="pill">+{data.extraMs / 60_000} min given</span>}
        {data.score !== null && (
          <b>
            Score {data.score} / {data.maxScore}
          </b>
        )}
      </div>
      {data.status === "in_progress" && (
        <div className="row wrap">
          <button className="btn small" onClick={() => act("extend", { minutes: 10 })}>
            Give 10 more minutes
          </button>
          <button className="btn small" onClick={() => act("reset-device")}>
            Allow another device
          </button>
          <button className="btn small" style={{ color: "var(--bad)" }} onClick={() => act("force-submit")}>
            Submit now
          </button>
        </div>
      )}
      {msg && <ErrorBox message={msg} />}
      {data.similarTo.length > 0 && (
        <div className="error">
          Code very similar to another student&apos;s ({Math.max(...data.similarTo.map((s) => s.similarityPct))}% match). Compare the submissions before deciding.
        </div>
      )}
      {data.snapshots.length > 0 && (
        <div>
          <h3>Camera</h3>
          <div className="row wrap">
            {/* Every photo the AI review flagged, then the latest few. */}
            {[...data.snapshots.filter((s) => snapshotFlags(s).length > 0), ...data.snapshots.slice(-8).filter((s) => snapshotFlags(s).length === 0)].map((s) => (
              <div key={s.id} className="small muted center stack" style={{ gap: 4 }}>
                <Snapshot attemptId={data.id} snapshotId={s.id} size={120} />
                {new Date(s.at).toLocaleTimeString()}
                {snapshotFlags(s).map((f) => (
                  <span key={f} className="pill bad">
                    {f}
                  </span>
                ))}
                {s.review && !("error" in s.review) && s.review.note && <span style={{ maxWidth: 140 }}>{s.review.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <h3>Activity</h3>
        {data.events.length === 0 ? (
          <p className="muted small">No integrity events.</p>
        ) : (
          <table>
            <tbody>
              {data.events.map((e, i) => (
                <tr key={i}>
                  <td className="small muted">{new Date(e.at).toLocaleTimeString()}</td>
                  <td>{EVENT_LABELS[e.type] ?? e.type}</td>
                  <td className="small muted">{e.detail?.replace(/ \[[0-9a-f-]{36}\]$/, "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function TestMonitor() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [tab, setTab] = useState<"monitor" | "results">("monitor");
  const [open, setOpen] = useState<string | null>(null);
  const mon = useApi<Monitor>(`/console/assessments/${id}/monitor`);
  const results = useApi<Results>(tab === "results" ? `/console/assessments/${id}/results` : null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  // Live view: refresh every 5 seconds while the test window is open.
  useEffect(() => {
    if (tab !== "monitor") return;
    const t = setInterval(() => void mon.reload(), 5000);
    return () => clearInterval(t);
  }, [tab, mon.reload]);

  if (mon.loading && !mon.data) return <Loading />;
  if (mon.error || !mon.data) return <ErrorBox message={mon.error?.message ?? "Could not load"} onRetry={mon.reload} />;
  const { assessment: a, counts, students } = mon.data;
  const released = a.releasePolicy === "immediate" || a.resultsReleasedAt !== null;

  async function release() {
    try {
      await api(`/console/assessments/${id}/release`, { body: {} });
      void mon.reload();
    } catch (e) {
      setReleaseError(errorMessage(e));
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Link href="/console/tests" className="small">
        <Icon name="back" size={16} /> Tests
      </Link>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>{a.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {formatDate(a.openAt)} to {formatDate(a.closeAt)} · {a.durationMinutes} min · {a.sections.map((s) => `${s.title} (${s.pick})`).join(", ")}
          </p>
        </div>
        <div className="row">
          <button className={`btn small ${tab === "monitor" ? "primary" : ""}`} onClick={() => setTab("monitor")}>
            Live monitor
          </button>
          <button className={`btn small ${tab === "results" ? "primary" : ""}`} onClick={() => setTab("results")}>
            Results
          </button>
        </div>
      </div>

      {tab === "monitor" ? (
        <>
          <div className="grid">
            <Stat label="Writing now" value={counts.in_progress} />
            <Stat label="Submitted" value={counts.submitted} />
            <Stat label="Not started" value={counts.not_started} />
            <Stat label="Flagged (risk 40+)" value={students.filter((s) => s.riskScore >= 40).length} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: open ? "minmax(0, 3fr) minmax(320px, 2fr)" : "1fr" }}>
            <div className="card table-wrap" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Status</th>
                    <th>Answered</th>
                    <th>Time left</th>
                    <th>Signals</th>
                    <th>Risk</th>
                    {a.proctorLevel >= 2 && <th>Camera</th>}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.userId} className={s.attemptId ? "clickable" : ""} onClick={() => s.attemptId && setOpen(s.attemptId)} style={{ background: open === s.attemptId ? "var(--accent-soft)" : undefined }}>
                      <td>
                        <b>{s.name}</b>
                        <div className="muted small">
                          {s.rollNo} {s.lastSeenAt && s.status === "in_progress" ? `· seen ${timeAgo(s.lastSeenAt)}` : ""}
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${STATUS[s.status][1]}`}>{STATUS[s.status][0]}</span>
                      </td>
                      <td>
                        {s.answered}/{s.total}
                      </td>
                      <td>{s.timeLeftMs !== null ? `${Math.ceil(s.timeLeftMs / 60_000)} min` : "-"}</td>
                      <td className="small">
                        {Object.entries(s.integrity)
                          .map(([k, v]) => `${EVENT_LABELS[k] ?? k} ×${v}`)
                          .join(", ") || "-"}
                        {s.similarityPct >= 70 && <div style={{ color: "var(--bad)" }}>Code {s.similarityPct}% similar</div>}
                      </td>
                      <td>{s.attemptId ? riskPill(s.riskScore) : "-"}</td>
                      {a.proctorLevel >= 2 && <td>{s.latestSnapshot && s.attemptId ? <Snapshot attemptId={s.attemptId} snapshotId={s.latestSnapshot.id} size={56} /> : "-"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {open && <AttemptPanel key={open} attemptId={open} onClose={() => setOpen(null)} onChanged={() => void mon.reload()} />}
          </div>
          <p className="muted small">
            Risk adds up tab switches, leaving full screen, pastes, device changes and code similarity. It is evidence to review, never an automatic verdict.
          </p>
        </>
      ) : !results.data ? (
        <Loading />
      ) : (
        <>
          <div className="spread wrap">
            <div className="grid" style={{ flex: 1 }}>
              <Stat label="Submitted" value={results.data.summary.submitted} />
              <Stat label="Average" value={results.data.summary.average ?? "-"} sub={`out of ${results.data.summary.maxScore ?? "-"}`} />
              <Stat label="Highest" value={results.data.summary.highest ?? "-"} />
              <Stat label="Flagged" value={results.data.summary.flagged} />
            </div>
          </div>
          <div className="card spread">
            <span>{released ? "Results are visible to students." : "Students cannot see their scores yet. Review flagged attempts, then release."}</span>
            {!released && me.permissions.includes("assessments.manage") && (
              <button className="btn primary" onClick={release}>
                Release results
              </button>
            )}
          </div>
          {releaseError && <ErrorBox message={releaseError} />}
          {results.data.plagiarism.length > 0 && (
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Similar code</h2>
              {results.data.plagiarism.map((p, i) => (
                <div key={i} className="spread">
                  <span>
                    <button className="btn ghost small" onClick={() => { setTab("monitor"); setOpen(p.a.attemptId); }}>{p.a.name}</button> and{" "}
                    <button className="btn ghost small" onClick={() => { setTab("monitor"); setOpen(p.b.attemptId); }}>{p.b.name}</button>
                    <span className="muted small"> · {p.questionId}</span>
                  </span>
                  <span className={`pill ${p.flagged ? "bad" : "warn"}`}>{p.similarityPct}% match</span>
                </div>
              ))}
            </div>
          )}
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Student</th>
                  <th>Score</th>
                  {results.data.rows[0]?.sections.map((s) => <th key={s.title}>{s.title}</th>)}
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {results.data.rows.map((r) => (
                  <tr key={r.attemptId}>
                    <td>{r.rank}</td>
                    <td>
                      <b>{r.name}</b> <span className="muted small">{r.rollNo}</span>
                    </td>
                    <td>
                      <b>{r.score}</b> <span className="muted small">/ {r.maxScore}</span>
                    </td>
                    {r.sections.map((s) => (
                      <td key={s.title}>
                        {s.score} <span className="muted small">/ {s.max}</span>
                      </td>
                    ))}
                    <td>{riskPill(r.riskScore)}</td>
                  </tr>
                ))}
                {results.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted center">
                      No submissions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
