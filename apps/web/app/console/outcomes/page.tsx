"use client";

import { useState } from "react";
import { formatLpa, GRADUATE_STATUSES, type GraduateStatus, type OutcomeKind } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

type Status = "pending" | "verified" | "rejected";
interface Item {
  id: string;
  kind: OutcomeKind;
  kindLabel: string;
  organisation: string;
  detail: string;
  ctcRupees: number | null;
  outcomeDate: string;
  status: Status;
  reviewNote: string | null;
  updatedAt: string;
  student: { id: string; name: string; rollNo: string | null };
}
interface Summary {
  graduating: number;
  placed: number;
  placedOnCampus: number;
  placedOffCampus: number;
  higherStudies: number;
  startup: number;
  notKnown: number;
  medianCtc: number | null;
  highestCtc: number | null;
}
interface Batch {
  years: number[];
  report: {
    institution: string;
    year: number;
    departments: (Summary & { department: string })[];
    totals: Summary;
    exams: { exam: string; students: number }[];
    pendingReports: number;
    graduates: { id: string; name: string; rollNo: string | null; department: string; status: GraduateStatus; ctcRupees: number | null; where: string; campus: boolean; exams: string[] }[];
  } | null;
}

const TABS: [Status | "batch", string][] = [
  ["pending", "To verify"],
  ["verified", "Verified"],
  ["rejected", "Sent back"],
  ["batch", "Batch report"],
];
const money = (v: number | null) => (v === null ? "-" : formatLpa(v));
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

function Review({ item, onDone }: { item: Item; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function decide(verify: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/console/outcomes/${item.id}/review`, { body: { verify, note: verify ? null : note } });
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
            {item.student.name} {item.student.rollNo ? <span className="muted small">({item.student.rollNo})</span> : null}
          </b>
          <div>
            {item.kindLabel}: <b>{item.organisation}</b>
            {item.detail ? ` · ${item.detail}` : ""}
            {item.ctcRupees ? ` · ${formatLpa(item.ctcRupees)}` : ""}
          </div>
          <div className="small muted">Dated {item.outcomeDate}</div>
        </div>
      </div>
      {item.status === "rejected" && item.reviewNote && <div className="small muted">Sent back: {item.reviewNote}</div>}
      {item.status !== "verified" ? (
        <>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">Note for the student, if sending it back</span>
            <textarea className="prose" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Please bring the offer letter to the placement cell." />
          </label>
          <div className="row wrap">
            <button className="btn primary small" disabled={busy} onClick={() => decide(true)}>
              Verified: I've seen the letter
            </button>
            <button className="btn small" disabled={busy || !note.trim()} onClick={() => decide(false)}>
              Send back
            </button>
          </div>
        </>
      ) : (
        <div className="row wrap">
          <input aria-label="Reason, to withdraw verification" placeholder="Reason, to withdraw verification" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={{ maxWidth: 420 }} />
          <button className="btn ghost small" disabled={busy || !note.trim()} onClick={() => decide(false)}>
            Withdraw verification
          </button>
        </div>
      )}
      {msg && <ErrorBox message={msg} />}
    </article>
  );
}

function Queue({ status }: { status: Status }) {
  const { data, error, loading, reload } = useApi<{ outcomes: Item[]; total: number }>(`/console/outcomes?status=${status}`);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data?.outcomes.length) return <div className="card muted">{status === "pending" ? "Nothing waiting to be verified." : "None yet."}</div>;
  return (
    <>
      {data.total > data.outcomes.length && <div className="small muted">Showing {data.outcomes.length} of {data.total}.</div>}
      {data.outcomes.map((o) => (
        <Review key={`${o.id}-${o.updatedAt}`} item={o} onDone={reload} />
      ))}
    </>
  );
}

function BatchReport() {
  const [year, setYear] = useState<number | null>(null);
  const { data, error, loading, reload } = useApi<Batch>(`/console/outcomes/batch${year ? `?year=${year}` : ""}`);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data?.report) return <div className="card muted">No graduating year is on record yet. Import students' academic records under Placements first.</div>;
  const r = data.report;
  const tt = r.totals;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row wrap">
        <select aria-label="Graduating year" value={r.year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: "auto" }}>
          {data.years.map((y) => (
            <option key={y} value={y}>
              Graduating in {y}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          onClick={async () => {
            setMsg(null);
            try {
              const url = await fetchObjectUrl(`/console/outcomes/batch/export?year=${r.year}`);
              const a = document.createElement("a");
              a.href = url;
              a.download = `graduate-outcomes-${r.year}.csv`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 10_000);
            } catch (e) {
              setMsg(errorMessage(e));
            }
          }}
        >
          Download CSV
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
      {r.pendingReports > 0 && (
        <div className="card small" style={{ borderColor: "var(--warn)" }}>
          {r.pendingReports} report{r.pendingReports === 1 ? " is" : "s are"} waiting to be verified and {r.pendingReports === 1 ? "isn't" : "aren't"} counted yet.
        </div>
      )}
      <div className="grid">
        <div className="card">
          <div className="small muted">Placed</div>
          <span className="kpi">{pct(tt.placed, tt.graduating)}%</span>
          <div className="small muted">
            {tt.placed} of {tt.graduating} · {tt.placedOffCampus} off campus
          </div>
        </div>
        <div className="card">
          <div className="small muted">Higher studies</div>
          <span className="kpi">{tt.higherStudies}</span>
          <div className="small muted">{tt.startup} started a company</div>
        </div>
        <div className="card">
          <div className="small muted">Median salary</div>
          <span className="kpi">{money(tt.medianCtc)}</span>
          <div className="small muted">highest {money(tt.highestCtc)}</div>
        </div>
        <div className="card">
          <div className="small muted">Not known yet</div>
          <span className="kpi">{tt.notKnown}</span>
          <div className="small muted">no offer, admission or startup on record</div>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "12px 16px" }}>
          <h2 style={{ margin: 0 }}>By department</h2>
          <div className="small muted">Each graduate counts once: an offer (on or off campus) first, then an admission, then a startup. The NIRF and NAAC forms ask for these figures.</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>Graduating</th>
                <th>Placed</th>
                <th>Off campus</th>
                <th>Higher studies</th>
                <th>Startups</th>
                <th>Not known</th>
                <th>Median salary</th>
                <th>Highest</th>
              </tr>
            </thead>
            <tbody>
              {[...r.departments, { department: "Total", ...tt }].map((d) => (
                <tr key={d.department} style={d.department === "Total" ? { fontWeight: 600 } : undefined}>
                  <td>{d.department}</td>
                  <td>{d.graduating}</td>
                  <td>
                    {d.placed} <span className="small muted">({pct(d.placed, d.graduating)}%)</span>
                  </td>
                  <td>{d.placedOffCampus}</td>
                  <td>{d.higherStudies}</td>
                  <td>{d.startup}</td>
                  <td>{d.notKnown}</td>
                  <td>{money(d.medianCtc)}</td>
                  <td>{money(d.highestCtc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Qualifying exams</h2>
        {r.exams.length === 0 ? (
          <div className="small muted">None verified yet.</div>
        ) : (
          <div className="row wrap" style={{ gap: 8 }}>
            {r.exams.map((e) => (
              <span key={e.exam} className="pill">
                {e.exam}: {e.students}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "12px 16px" }}>
          <h2 style={{ margin: 0 }}>Graduates</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Roll no</th>
                <th>Student</th>
                <th>Department</th>
                <th>Outcome</th>
                <th>Where</th>
                <th>Salary</th>
              </tr>
            </thead>
            <tbody>
              {r.graduates.map((g) => (
                <tr key={g.id}>
                  <td className="small">{g.rollNo ?? "-"}</td>
                  <td>{g.name}</td>
                  <td className="small">{g.department}</td>
                  <td>
                    <span className={`pill ${g.status === "not_known" ? "" : "good"}`}>{GRADUATE_STATUSES[g.status]}</span>
                    {g.status === "placed" && !g.campus ? <span className="small muted"> · off campus</span> : null}
                  </td>
                  <td className="small">
                    {g.where || "-"}
                    {g.exams.length ? <span className="muted"> · {g.exams.join(", ")}</span> : null}
                  </td>
                  <td className="small">{money(g.ctcRupees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function GraduateOutcomes() {
  const [tab, setTab] = useState<Status | "batch">("pending");
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1100 }}>
      <div>
        <h1 style={{ margin: 0 }}>Graduate outcomes</h1>
        <p className="muted" style={{ margin: 0 }}>
          Offers students found off campus, admissions for higher studies, qualifying exams and startups. Check the letter or scorecard before verifying: only verified reports count in the batch report.
        </p>
      </div>
      <div className="row" role="group" aria-label="Show">
        {TABS.map(([key, label]) => (
          <button key={key} className={`btn small ${tab === key ? "primary" : ""}`} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "batch" ? <BatchReport /> : <Queue key={tab} status={tab} />}
    </div>
  );
}
