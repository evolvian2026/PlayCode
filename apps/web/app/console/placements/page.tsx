"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { COMPANY_TYPE_LABELS, formatLpa, type CompanyType } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface DriveRow {
  id: string;
  company: string;
  companyType: CompanyType;
  roleTitle: string;
  ctcRupees: number;
  driveDate: string;
  registerBy: string;
  status: "open" | "closed" | "completed";
  rounds: number;
  registered: number;
  offers: number;
}

const STATUS_TONE: Record<DriveRow["status"], string> = { open: "good", closed: "warn", completed: "" };

function inDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function NewDrive({ onCreated }: { onCreated: (notified: number) => void }) {
  const units = useApi<{ units: { id: string; name: string; kind: string }[] }>("/console/org-units");
  const packs = useApi<{ packs: { id: string; title: string }[] }>("/console/packs");
  const [f, setF] = useState({
    company: "",
    companyType: "service" as CompanyType,
    roleTitle: "",
    ctcLpa: "",
    location: "",
    driveDate: inDays(14),
    registerBy: inDays(7),
    description: "",
    minCgpa: "",
    maxBacklogs: "0",
    min10th: "",
    min12th: "",
    years: "",
    allowPlaced: false,
    packId: "",
    rounds: "Online test\nTechnical interview\nHR interview",
  });
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ notified: number }>("/console/placements", {
        body: {
          company: f.company,
          companyType: f.companyType,
          roleTitle: f.roleTitle,
          ctcRupees: Math.round(Number(f.ctcLpa) * 100_000),
          location: f.location,
          driveDate: f.driveDate,
          // Registration closes at the end of the chosen day.
          registerBy: new Date(`${f.registerBy}T23:59:00`).toISOString(),
          description: f.description,
          criteria: {
            unitIds,
            minCgpa: num(f.minCgpa),
            maxBacklogs: num(f.maxBacklogs),
            min10th: num(f.min10th),
            min12th: num(f.min12th),
            graduationYears: f.years.trim() ? f.years.split(/[,\s]+/).filter(Boolean).map(Number) : null,
            allowPlaced: f.allowPlaced,
          },
          rounds: f.rounds.split("\n").map((r) => r.trim()).filter(Boolean),
          packId: f.packId || null,
        },
      });
      onCreated(res.notified);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>New placement drive</h2>
      <div className="row wrap">
        <div style={{ flex: 2, minWidth: 200 }}>
          <label htmlFor="d-company">Company</label>
          <input id="d-company" value={f.company} onChange={(e) => set({ company: e.target.value })} required maxLength={120} placeholder="e.g. Infosys" />
        </div>
        <div>
          <label htmlFor="d-type">Kind</label>
          <select id="d-type" value={f.companyType} onChange={(e) => set({ companyType: e.target.value as CompanyType })}>
            {(Object.keys(COMPANY_TYPE_LABELS) as CompanyType[]).map((t) => (
              <option key={t} value={t}>
                {COMPANY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label htmlFor="d-role">Role</label>
          <input id="d-role" value={f.roleTitle} onChange={(e) => set({ roleTitle: e.target.value })} required maxLength={120} placeholder="e.g. Systems Engineer" />
        </div>
        <div style={{ width: 120 }}>
          <label htmlFor="d-ctc">CTC (LPA)</label>
          <input id="d-ctc" type="number" step="0.01" min={0.1} value={f.ctcLpa} onChange={(e) => set({ ctcLpa: e.target.value })} required placeholder="3.6" />
        </div>
      </div>
      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="d-loc">Location</label>
          <input id="d-loc" value={f.location} onChange={(e) => set({ location: e.target.value })} maxLength={120} placeholder="e.g. Bengaluru, Pune" />
        </div>
        <div>
          <label htmlFor="d-date">Drive date</label>
          <input id="d-date" type="date" value={f.driveDate} onChange={(e) => set({ driveDate: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="d-reg">Register by</label>
          <input id="d-reg" type="date" value={f.registerBy} onChange={(e) => set({ registerBy: e.target.value })} required />
        </div>
      </div>
      <div>
        <label htmlFor="d-desc">Details for students</label>
        <textarea id="d-desc" rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={4000} placeholder="Selection process, documents to bring, bond, etc." />
      </div>
      <div>
        <label>Branches and batches invited (none ticked: everyone)</label>
        <div className="row wrap">
          {units.data?.units
            .filter((u) => u.kind !== "section")
            .map((u) => (
              <label key={u.id} className="row" style={{ gap: 4, fontWeight: 500 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={unitIds.includes(u.id)} onChange={(e) => setUnitIds(e.target.checked ? [...unitIds, u.id] : unitIds.filter((x) => x !== u.id))} />
                {u.name}
              </label>
            ))}
        </div>
      </div>
      <div className="row wrap">
        <div style={{ width: 110 }}>
          <label htmlFor="d-cgpa">Min CGPA</label>
          <input id="d-cgpa" type="number" step="0.1" min={0} max={10} value={f.minCgpa} onChange={(e) => set({ minCgpa: e.target.value })} placeholder="any" />
        </div>
        <div style={{ width: 120 }}>
          <label htmlFor="d-back">Max backlogs</label>
          <input id="d-back" type="number" min={0} max={60} value={f.maxBacklogs} onChange={(e) => set({ maxBacklogs: e.target.value })} placeholder="any" />
        </div>
        <div style={{ width: 110 }}>
          <label htmlFor="d-10">Min class 10 %</label>
          <input id="d-10" type="number" min={0} max={100} value={f.min10th} onChange={(e) => set({ min10th: e.target.value })} placeholder="any" />
        </div>
        <div style={{ width: 110 }}>
          <label htmlFor="d-12">Min class 12 %</label>
          <input id="d-12" type="number" min={0} max={100} value={f.min12th} onChange={(e) => set({ min12th: e.target.value })} placeholder="any" />
        </div>
        <div style={{ width: 150 }}>
          <label htmlFor="d-years">Graduating in</label>
          <input id="d-years" value={f.years} onChange={(e) => set({ years: e.target.value })} placeholder="e.g. 2027" />
        </div>
      </div>
      <label className="row" style={{ gap: 6, fontWeight: 500 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={f.allowPlaced} onChange={(e) => set({ allowPlaced: e.target.checked })} /> Students who already hold an offer may register (dream drive)
      </label>
      <div className="row wrap" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="d-rounds">Selection rounds, one per line</label>
          <textarea id="d-rounds" rows={4} value={f.rounds} onChange={(e) => set({ rounds: e.target.value })} required />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="d-pack">Mission to prepare with (optional)</label>
          <select id="d-pack" value={f.packId} onChange={(e) => set({ packId: e.target.value })}>
            <option value="">None</option>
            {packs.data?.packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Eligible students get a message in the app (and on WhatsApp where set up) as soon as you create the drive. Eligibility uses the academic records you import.
      </p>
      {error && <ErrorBox message={error} />}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy}>
        Create drive and tell students
      </button>
    </form>
  );
}

function RecordsImport({ onDone }: { onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ updated: number; notFound: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setResult(await api("/console/placements/records", { body: { csv } }));
      setCsv("");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>Academic records</h2>
      <p className="small muted" style={{ margin: 0 }}>
        One row per student: roll number or email, CGPA, active backlogs, class 10 %, class 12 or diploma %, graduation year. Leave a cell empty if you don&apos;t have it.
        Importing again updates the records.
      </p>
      <textarea aria-label="Academic records CSV" rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} required placeholder={"roll_no,cgpa,backlogs,class_10,class_12,graduation_year\nCSE27A001,8.2,0,91,88,2027"} />
      {error && <ErrorBox message={error} />}
      {result && (
        <div className="small">
          Updated {result.updated} records.{result.notFound.length > 0 && ` Not found: ${result.notFound.slice(0, 10).join(", ")}${result.notFound.length > 10 ? "..." : ""}`}
        </div>
      )}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!csv.trim()}>
        Import records
      </button>
    </form>
  );
}

export default function PlacementsPage() {
  const { data, error, loading, reload } = useApi<{ drives: DriveRow[] }>("/console/placements");
  const [panel, setPanel] = useState<"none" | "drive" | "records">("none");
  const [notice, setNotice] = useState<string | null>(null);
  const toggle = (p: "drive" | "records") => setPanel(panel === p ? "none" : p);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>Placements</h1>
          <p className="muted" style={{ margin: 0 }}>
            Companies visiting campus, who registered, who cleared each round and who got an offer.
          </p>
        </div>
        <div className="row wrap">
          <Link className="btn" href="/console/placements/outcomes">
            Outcomes
          </Link>
          <button className="btn" onClick={() => toggle("records")}>
            Academic records
          </button>
          <button className="btn primary" onClick={() => toggle("drive")}>
            {panel === "drive" ? "Close" : "New drive"}
          </button>
        </div>
      </div>
      {notice && <div className="pill good" style={{ alignSelf: "flex-start" }}>{notice}</div>}
      {panel === "records" && <RecordsImport onDone={reload} />}
      {panel === "drive" && (
        <NewDrive
          onCreated={(n) => {
            setPanel("none");
            setNotice(`Drive created. ${n} eligible students were told.`);
            reload();
          }}
        />
      )}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data?.drives.length === 0 ? (
        <div className="card muted">No drives yet. Import academic records first, then add the companies visiting campus.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Drive date</th>
                  <th>CTC</th>
                  <th>Registered</th>
                  <th>Offers</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.drives.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/console/placements/${d.id}`}>{d.company}</Link>
                      <div className="small muted">
                        {d.roleTitle} · {COMPANY_TYPE_LABELS[d.companyType]}
                      </div>
                    </td>
                    <td>
                      {new Date(`${d.driveDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      {d.status === "open" && <div className="small muted">register by {new Date(d.registerBy).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>}
                    </td>
                    <td>{formatLpa(d.ctcRupees)}</td>
                    <td>{d.registered}</td>
                    <td>{d.offers}</td>
                    <td>
                      <span className={`pill ${STATUS_TONE[d.status]}`}>{d.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
