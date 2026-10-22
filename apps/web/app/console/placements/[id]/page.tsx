"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { COMPANY_TYPE_LABELS, formatLpa, type CompanyType } from "@playcode/core";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

type Status = "registered" | "shortlisted" | "rejected" | "offered" | "withdrawn";

interface Detail {
  drive: {
    id: string;
    company: string;
    companyType: CompanyType;
    roleTitle: string;
    description: string;
    ctcRupees: number;
    location: string;
    driveDate: string;
    registerBy: string;
    rounds: string[];
    status: "open" | "closed" | "completed";
    criteria: { units: { id: string; name: string }[]; minCgpa?: number | null; maxBacklogs?: number | null; min10th?: number | null; min12th?: number | null; graduationYears?: number[] | null; allowPlaced?: boolean };
  };
  readinessProfile: string;
  summary: { eligible: number; registered: number; notRegistered: number; perRound: { name: string; cleared: number }[]; offers: number };
  applicants: {
    userId: string;
    name: string;
    rollNo: string | null;
    email: string;
    record: { cgpa: number | null; backlogs: number | null } | null;
    status: Status;
    roundsCleared: number;
    offerCtcRupees: number | null;
    readinessAtRegistration: number;
    activeDays60: number;
  }[];
}

const STATUS_TONE: Record<Status, string> = { registered: "", shortlisted: "accent", rejected: "bad", offered: "good", withdrawn: "" };

function criteriaText(c: Detail["drive"]["criteria"]): string {
  const parts = [
    c.units.length ? c.units.map((u) => u.name).join(", ") : "All branches",
    c.graduationYears?.length ? `${c.graduationYears.join(", ")} batch` : null,
    c.minCgpa != null ? `CGPA ${c.minCgpa}+` : null,
    c.maxBacklogs != null ? (c.maxBacklogs === 0 ? "no backlogs" : `up to ${c.maxBacklogs} backlogs`) : null,
    c.min10th != null ? `class 10 ${c.min10th}%+` : null,
    c.min12th != null ? `class 12 ${c.min12th}%+` : null,
    c.allowPlaced ? "open to placed students" : "students without an offer",
  ];
  return parts.filter(Boolean).join(" · ");
}

export default function PlacementDrive() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Detail>(`/console/placements/${id}`);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "in" | "offered" | "rejected">("all");
  const [ctc, setCtc] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function act(action: "advance" | "reject" | "offer" | "reset") {
    setMsg(null);
    try {
      await api(`/console/placements/${id}/applications`, {
        body: { userIds: selected, action, ...(action === "offer" && ctc ? { ctcRupees: Math.round(Number(ctc) * 100_000) } : {}) },
      });
      setSelected([]);
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  async function setStatus(status: Detail["drive"]["status"]) {
    await api(`/console/placements/${id}/status`, { body: { status } }).catch((e) => setMsg(errorMessage(e)));
    reload();
  }

  async function download() {
    const url = await fetchObjectUrl(`/console/placements/${id}/export`);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data?.drive.company ?? "drive"}-registrations.csv`;
    a.click();
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const { drive, summary } = data;
  const applicants = data.applicants.filter((a) => a.status !== "withdrawn").filter((a) => (filter === "all" ? true : filter === "in" ? a.status === "registered" || a.status === "shortlisted" : a.status === filter));
  const allSelected = applicants.length > 0 && applicants.every((a) => selected.includes(a.userId));
  const stage = (a: Detail["applicants"][number]) =>
    a.status === "offered" ? `Offer · ${formatLpa(a.offerCtcRupees ?? drive.ctcRupees)}` : a.status === "rejected" ? `Not selected after ${a.roundsCleared ? drive.rounds[a.roundsCleared - 1] : "registration"}` : a.roundsCleared ? `Cleared ${drive.rounds[a.roundsCleared - 1]}` : "Registered";

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <Link href="/console/placements" className="small muted">
            Placements
          </Link>
          <h1 style={{ margin: 0 }}>
            {drive.company} <span className="muted" style={{ fontWeight: 500 }}>· {drive.roleTitle}</span>
          </h1>
          <div className="muted small">
            {COMPANY_TYPE_LABELS[drive.companyType]} · {formatLpa(drive.ctcRupees)} · {drive.location || "Location to be announced"} · drive on{" "}
            {new Date(`${drive.driveDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </div>
          <div className="muted small">Eligibility: {criteriaText(drive.criteria)}</div>
        </div>
        <div className="row wrap">
          <button className="btn small" onClick={download}>
            Export registrations (CSV)
          </button>
          {drive.status === "open" && (
            <button className="btn small ghost" onClick={() => setStatus("closed")}>
              Close registration
            </button>
          )}
          {drive.status !== "completed" && (
            <button className="btn small ghost" onClick={() => setStatus("completed")}>
              Mark completed
            </button>
          )}
          {drive.status !== "open" && (
            <button className="btn small ghost" onClick={() => setStatus("open")}>
              Reopen
            </button>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: `repeat(${3 + drive.rounds.length}, minmax(110px, 1fr))` }}>
        <Stat label="Eligible" value={summary.eligible} sub={summary.notRegistered ? `${summary.notRegistered} not registered` : "all registered"} />
        <Stat label="Registered" value={summary.registered} />
        {summary.perRound.map((r, i) => (
          <Stat key={i} label={`Cleared: ${r.name}`} value={r.cleared} />
        ))}
        <Stat label="Offers" value={summary.offers} />
      </div>

      <div className="card stack" style={{ padding: 0 }}>
        <div className="spread wrap" style={{ padding: "12px 16px 0" }}>
          <div className="row wrap">
            {(["all", "in", "offered", "rejected"] as const).map((f) => (
              <button key={f} className={`btn small ${filter === f ? "primary" : "ghost"}`} onClick={() => setFilter(f)}>
                {{ all: "Everyone", in: "Still in the process", offered: "Offers", rejected: "Not selected" }[f]}
              </button>
            ))}
          </div>
          <div className="row wrap">
            <span className="small muted">{selected.length} selected</span>
            <button className="btn small" disabled={!selected.length} onClick={() => act("advance")}>
              Cleared next round
            </button>
            <button className="btn small ghost" disabled={!selected.length} onClick={() => act("reject")}>
              Not selected
            </button>
            <input aria-label="Offer CTC (LPA)" type="number" step="0.01" placeholder={`${drive.ctcRupees / 100_000} LPA`} value={ctc} onChange={(e) => setCtc(e.target.value)} style={{ width: 110 }} />
            <button className="btn small primary" disabled={!selected.length} onClick={() => act("offer")}>
              Record offer
            </button>
            <button className="btn small ghost" disabled={!selected.length} onClick={() => act("reset")}>
              Undo
            </button>
          </div>
        </div>
        {msg && (
          <div style={{ padding: "0 16px" }}>
            <ErrorBox message={msg} />
          </div>
        )}
        {applicants.length === 0 ? (
          <div className="muted" style={{ padding: 16 }}>
            Nobody here yet.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" aria-label="Select all" style={{ width: "auto" }} checked={allSelected} onChange={(e) => setSelected(e.target.checked ? applicants.map((a) => a.userId) : [])} />
                  </th>
                  <th>Student</th>
                  <th>CGPA</th>
                  <th title={`${data.readinessProfile === "product" ? "Product" : "Service"} company readiness when they registered`}>Readiness</th>
                  <th title="Days with practice in the 60 days before registering">Practice days</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {applicants.map((a) => (
                  <tr key={a.userId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${a.name}`}
                        style={{ width: "auto" }}
                        checked={selected.includes(a.userId)}
                        onChange={(e) => setSelected(e.target.checked ? [...selected, a.userId] : selected.filter((x) => x !== a.userId))}
                      />
                    </td>
                    <td>
                      <Link href={`/console/students/${a.userId}`}>{a.name}</Link>
                      <div className="small muted">{a.rollNo ?? a.email}</div>
                    </td>
                    <td>
                      {a.record?.cgpa ?? "-"}
                      {a.record?.backlogs ? <div className="small muted">{a.record.backlogs} backlogs</div> : null}
                    </td>
                    <td>{a.readinessAtRegistration}</td>
                    <td>{a.activeDays60}</td>
                    <td>
                      <span className={`pill ${STATUS_TONE[a.status]}`}>{stage(a)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {drive.description && (
        <div className="card">
          <h2>Details shared with students</h2>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{drive.description}</p>
        </div>
      )}
    </div>
  );
}
