"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { COMPANY_TYPE_LABELS, formatLpa, OFFER_TIERS, type CompanyType, type OfferTier, type PlacementPolicy } from "@playcode/core";
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
  tier: OfferTier | null;
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
    minAttendance: "",
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
            minAttendancePct: num(f.minAttendance),
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
          <label htmlFor="d-att">Min training attendance %</label>
          <input id="d-att" type="number" min={0} max={100} value={f.minAttendance} onChange={(e) => set({ minAttendance: e.target.value })} placeholder="any" />
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

function PolicySettings({ onSaved }: { onSaved: () => void }) {
  const { data, error, reload } = useApi<PlacementPolicy>("/console/placements/policy");
  const [f, setF] = useState<PlacementPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return <Loading />;
  const p = f ?? data;
  const lakhs = (v: number) => String(v / 100_000);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/console/placements/policy", { method: "PUT", body: p });
      setMsg("Saved.");
      onSaved();
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>Placement policy</h2>
      <p className="small muted" style={{ margin: 0 }}>
        With tiers on, a student who holds an offer can only register for drives in a higher tier, and nobody can hold more than the maximum number of offers. A drive set to take students with offers still counts the maximum. Without tiers, each drive decides whether students with offers may register.
      </p>
      <label>
        <input type="checkbox" checked={p.tiers} onChange={(e) => setF({ ...p, tiers: e.target.checked })} style={{ width: "auto", marginRight: 6 }} />
        Use Regular, Dream and Super dream tiers
      </label>
      <div className="row wrap">
        <div>
          <label htmlFor="p-dream">Dream from (LPA)</label>
          <input id="p-dream" type="number" min={1} step={0.5} value={lakhs(p.dreamFromRupees)} onChange={(e) => setF({ ...p, dreamFromRupees: Math.round(Number(e.target.value) * 100_000) })} style={{ maxWidth: 140 }} />
        </div>
        <div>
          <label htmlFor="p-super">Super dream from (LPA)</label>
          <input id="p-super" type="number" min={1} step={0.5} value={lakhs(p.superDreamFromRupees)} onChange={(e) => setF({ ...p, superDreamFromRupees: Math.round(Number(e.target.value) * 100_000) })} style={{ maxWidth: 140 }} />
        </div>
        <div>
          <label htmlFor="p-max">Most offers a student can hold</label>
          <input id="p-max" type="number" min={1} max={5} value={p.maxOffers} onChange={(e) => setF({ ...p, maxOffers: Number(e.target.value) })} style={{ maxWidth: 100 }} />
        </div>
        <div>
          <label htmlFor="p-noshow">Missed drives allowed (empty for no limit)</label>
          <input id="p-noshow" type="number" min={1} max={10} value={p.maxNoShows ?? ""} onChange={(e) => setF({ ...p, maxNoShows: e.target.value ? Number(e.target.value) : null })} style={{ maxWidth: 100 }} />
        </div>
        <div>
          <label htmlFor="p-days">Days to answer an offer</label>
          <input id="p-days" type="number" min={1} max={14} value={p.decisionDays} onChange={(e) => setF({ ...p, decisionDays: Number(e.target.value) })} style={{ maxWidth: 100 }} />
        </div>
      </div>
      <div className="small muted">A missed drive is an interview slot marked &ldquo;Didn&apos;t come&rdquo;; mark it &ldquo;Excused absence&rdquo; when the student had a reason. Students who reach the limit can&apos;t register for new drives. Students accept or decline each offer in the app. Accepting one declines their other offers still waiting for an answer; offers left unanswered are taken as accepted when the time runs out.</div>
      <div className="row">
        <button className="btn primary small" disabled={busy}>
          {busy ? "Saving..." : "Save policy"}
        </button>
        {msg && (
          <span className="small" role="status">
            {msg}
          </span>
        )}
      </div>
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

interface InstitutionTalent {
  open: boolean;
  inPool: number;
  companies: { company: string; invited: number; accepted: number }[];
  invites: { id: string; userId: string; student: string; rollNo: string | null; company: string; roleTitle: string; status: string; createdAt: string }[];
}

/** Companies finding students through the talent pool, and the switch that lets students join. */
function TalentPool() {
  const { data, error, reload, setData } = useApi<InstitutionTalent>("/console/talent/institution");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return null;

  async function setOpen(open: boolean) {
    if (!open && !window.confirm("Close the talent pool? Companies will stop finding your students at once.")) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api("/console/talent/institution", { method: "PUT", body: { open } });
      setData({ ...data!, open });
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="spread wrap">
        <div>
          <h2 style={{ margin: 0 }}>Talent pool</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {data.open
              ? `Open: ${data.inPool} student${data.inPool === 1 ? "" : "s"} chose to be found by companies hiring on PlayCode. Companies see their verified record, and their contact details only when a student accepts an invitation.`
              : "Closed. When open, students can choose to be found by companies hiring on PlayCode, by their measured readiness and skills."}
          </p>
        </div>
        <button className={`btn ${data.open ? "" : "primary"}`} disabled={busy} onClick={() => setOpen(!data.open)}>
          {data.open ? "Close the pool" : "Open the talent pool"}
        </button>
      </div>
      {saveError && <ErrorBox message={saveError} />}
      {data.companies.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Students invited</th>
                <th>Accepted</th>
              </tr>
            </thead>
            <tbody>
              {data.companies.map((c) => (
                <tr key={c.company}>
                  <td>{c.company}</td>
                  <td>{c.invited}</td>
                  <td>{c.accepted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.invites.length > 0 && (
        <details>
          <summary className="small">Latest invitations</summary>
          <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {data.invites.slice(0, 20).map((i) => (
              <li key={i.id}>
                <Link href={`/console/students/${i.userId}`}>{i.student}</Link> · {i.company}, {i.roleTitle} · {i.status}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function PlacementsPage() {
  const { data, error, loading, reload } = useApi<{ drives: DriveRow[] }>("/console/placements");
  const [panel, setPanel] = useState<"none" | "drive" | "records" | "policy">("none");
  const [notice, setNotice] = useState<string | null>(null);
  const toggle = (p: "drive" | "records" | "policy") => setPanel(panel === p ? "none" : p);
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
          <button className="btn" aria-pressed={panel === "policy"} onClick={() => toggle("policy")}>
            Policy
          </button>
          <button className="btn primary" onClick={() => toggle("drive")}>
            {panel === "drive" ? "Close" : "New drive"}
          </button>
        </div>
      </div>
      {notice && <div className="pill good" style={{ alignSelf: "flex-start" }}>{notice}</div>}
      {panel === "records" && <RecordsImport onDone={reload} />}
      {panel === "policy" && <PolicySettings onSaved={reload} />}
      {panel === "drive" && (
        <NewDrive
          onCreated={(n) => {
            setPanel("none");
            setNotice(`Drive created. ${n} eligible students were told.`);
            reload();
          }}
        />
      )}
      <TalentPool />
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
                    <td>
                      {formatLpa(d.ctcRupees)}
                      {d.tier && <div className="small muted">{OFFER_TIERS[d.tier]}</div>}
                    </td>
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
