"use client";

import { useState } from "react";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

type Status = "healthy" | "watch" | "at_risk";

interface Customer {
  id: string;
  name: string;
  type: string;
  partner: string | null;
  plan: string;
  seats: number;
  students: number;
  weeklyActive: number;
  weeklyActivePct: number;
  trend: number | null;
  answersPerActive: number;
  staffActive7: number;
  assignments30: number;
  aiTokensThisMonth: number;
  validUntil: string | null;
  licenceDaysLeft: number | null;
  overdueDays: number;
  status: Status;
  reasons: string[];
}

interface Health {
  summary: { customers: number; healthy: number; watch: number; at_risk: number; renewalsIn90Days: number; students: number; weeklyActive: number };
  customers: Customer[];
}

const LABEL: Record<Status, string> = { healthy: "Healthy", watch: "Watch", at_risk: "At risk" };
const TONE: Record<Status, string> = { healthy: "good", watch: "warn", at_risk: "bad" };

export default function CustomerHealth() {
  const { data, error, loading, reload } = useApi<Health>("/admin/health");
  const [filter, setFilter] = useState<Status | "renewals" | "all">("all");

  async function renew(c: Customer) {
    const months = window.prompt(`Renew ${c.name} by how many months?`, "12");
    if (!months) return;
    try {
      await api(`/admin/tenants/${c.id}/renew`, { body: { months: Number(months) } });
      reload();
    } catch (e) {
      window.alert(errorMessage(e));
    }
  }

  async function download() {
    const url = await fetchObjectUrl("/admin/health/export");
    const a = document.createElement("a");
    a.href = url;
    a.download = "customer-health.csv";
    a.click();
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const { summary } = data;
  const rows = data.customers.filter((c) =>
    filter === "all" ? true : filter === "renewals" ? c.licenceDaysLeft !== null && c.licenceDaysLeft >= 0 && c.licenceDaysLeft <= 90 : c.status === filter,
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Customer health</h1>
          <p className="muted" style={{ margin: 0 }}>
            Whether students and staff use PlayCode each week, and what puts each renewal at risk. The goal is 40% of students active weekly and staff in the console every week.
          </p>
        </div>
        <button className="btn small" onClick={download}>
          Export (CSV)
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Stat label="Customers" value={summary.customers} />
        <Stat label="At risk" value={summary.at_risk} />
        <Stat label="Watch" value={summary.watch} />
        <Stat label="Renewals in 90 days" value={summary.renewalsIn90Days} />
        <Stat label="Weekly active" value={summary.students ? `${Math.round((summary.weeklyActive / summary.students) * 100)}%` : "-"} sub={`${summary.weeklyActive} of ${summary.students} students`} />
      </div>
      <div className="row wrap">
        {(["all", "at_risk", "watch", "healthy", "renewals"] as const).map((f) => (
          <button key={f} className={`btn small ${filter === f ? "primary" : "ghost"}`} onClick={() => setFilter(f)}>
            {f === "all" ? "Everyone" : f === "renewals" ? "Renewing soon" : LABEL[f]}
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Health</th>
                <th>Students / seats</th>
                <th title="Students who answered a question in the last 7 days">Weekly active</th>
                <th title="Answers per active student in the last 7 days">Answers</th>
                <th title="Staff who used the console in the last 7 days">Staff</th>
                <th title="Assignments created in the last 30 days">Assignments</th>
                <th>Licence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                    <div className="small muted">
                      {c.plan}
                      {c.partner && ` · via ${c.partner}`}
                      {c.type === "company" && " · company"}
                    </div>
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    <span className={`pill ${TONE[c.status]}`}>{LABEL[c.status]}</span>
                    {c.reasons.length > 0 && <div className="small muted">{c.reasons.join(" · ")}</div>}
                  </td>
                  <td>
                    {c.students} / {c.seats}
                  </td>
                  <td>
                    {c.weeklyActivePct}%{" "}
                    {c.trend !== null && c.trend !== 0 && (
                      <span className="small" style={{ color: c.trend > 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>
                        {c.trend > 0 ? "+" : ""}
                        {c.trend}
                      </span>
                    )}
                    <div className="small muted">{c.weeklyActive} students</div>
                  </td>
                  <td>{c.answersPerActive}</td>
                  <td>{c.staffActive7}</td>
                  <td>{c.assignments30}</td>
                  <td className="small">
                    {c.validUntil ? new Date(`${c.validUntil}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-"}
                    {c.overdueDays > 0 && <div style={{ color: "var(--bad-ink)" }}>{c.overdueDays} days overdue</div>}
                    {c.licenceDaysLeft !== null && c.licenceDaysLeft <= 90 && (
                      <button className="btn small ghost" style={{ padding: "2px 0" }} onClick={() => renew(c)}>
                        Renew
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The trend compares weekly active students with the same week a month ago, in percentage points.
      </p>
    </div>
  );
}
