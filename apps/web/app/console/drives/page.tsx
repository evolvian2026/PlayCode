"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorBox, formatDate, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface DriveRow {
  id: string;
  title: string;
  roleTitle: string;
  status: "open" | "closed";
  inviteCode: string;
  openAt: string;
  closeAt: string;
  candidates: number;
  tested: number;
  shortlisted: number;
}

const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function NewDrive({ onDone }: { onDone: () => void }) {
  const skills = useApi<{ skills: { id: string; name: string; topicName: string }[] }>("/console/skills");
  const [f, setF] = useState({ title: "", roleTitle: "", description: "", durationMinutes: 60, cutoffPct: 60, proctorLevel: 2 as 1 | 2 | 3 });
  const [openAt, setOpenAt] = useState(local(new Date()));
  const [closeAt, setCloseAt] = useState(local(new Date(Date.now() + 14 * 86_400_000)));
  const [aptitude, setAptitude] = useState<string[]>(["loops.for", "loops.while", "arrays.basics", "pseudocode.basics"]);
  const [mcqCount, setMcqCount] = useState(10);
  const [coding, setCoding] = useState(2);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const sections = [{ title: "Aptitude for code", skillIds: aptitude, pick: mcqCount, marks: 1, negative: 0.25 }];
    if (coding > 0) sections.push({ title: "Coding", skillIds: ["coding.basics"], pick: coding, marks: 10, negative: 0 });
    try {
      await api("/console/drives", { body: { ...f, openAt: new Date(openAt).toISOString(), closeAt: new Date(closeAt).toISOString(), sections } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>New hiring drive</h2>
      <div className="row wrap">
        <input aria-label="Drive name" placeholder="Drive name, e.g. Campus hiring 2027" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required style={{ flex: 1, minWidth: 220 }} />
        <input aria-label="Role" placeholder="Role, e.g. Graduate Engineer Trainee" value={f.roleTitle} onChange={(e) => setF({ ...f, roleTitle: e.target.value })} required style={{ flex: 1, minWidth: 220 }} />
      </div>
      <textarea aria-label="Description" rows={2} placeholder="What candidates should know (shown on the apply page)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ fontFamily: "inherit" }} />
      <div className="row wrap">
        <div>
          <label htmlFor="d-open">Opens</label>
          <input id="d-open" type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} />
        </div>
        <div>
          <label htmlFor="d-close">Closes</label>
          <input id="d-close" type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} />
        </div>
        <div style={{ width: 130 }}>
          <label htmlFor="d-dur">Minutes</label>
          <input id="d-dur" type="number" min={5} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} />
        </div>
        <div style={{ width: 130 }}>
          <label htmlFor="d-cut">Cut-off %</label>
          <input id="d-cut" type="number" min={0} max={100} value={f.cutoffPct} onChange={(e) => setF({ ...f, cutoffPct: Number(e.target.value) })} />
        </div>
        <div>
          <label htmlFor="d-proc">Proctoring</label>
          <select id="d-proc" value={f.proctorLevel} onChange={(e) => setF({ ...f, proctorLevel: Number(e.target.value) as 1 | 2 | 3 })}>
            <option value={3}>Camera, one device and AI photo checks</option>
            <option value={2}>Camera and one device</option>
            <option value={1}>Light</option>
          </select>
        </div>
      </div>
      <div>
        <label>Aptitude section: {mcqCount} questions from</label>
        <div className="row wrap" style={{ gap: 6 }}>
          {skills.data?.skills
            .filter((s) => !s.id.startsWith("coding.") && !s.id.startsWith("sql."))
            .map((s) => (
              <button type="button" key={s.id} className={`btn small ${aptitude.includes(s.id) ? "primary" : ""}`} onClick={() => setAptitude(aptitude.includes(s.id) ? aptitude.filter((x) => x !== s.id) : [...aptitude, s.id])}>
                {s.name}
              </button>
            ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label htmlFor="d-mcq" style={{ margin: 0 }}>
            Questions
          </label>
          <input id="d-mcq" type="number" min={1} max={50} value={mcqCount} onChange={(e) => setMcqCount(Number(e.target.value))} style={{ width: 90 }} />
          <label htmlFor="d-code" style={{ margin: 0 }}>
            Coding problems
          </label>
          <input id="d-code" type="number" min={0} max={5} value={coding} onChange={(e) => setCoding(Number(e.target.value))} style={{ width: 90 }} />
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="row">
        <button className="btn primary" disabled={!f.title || !f.roleTitle || !aptitude.length}>
          Create drive
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function Drives() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApi<{ drives: DriveRow[] }>("/console/drives");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <div>
          <h1 style={{ margin: 0 }}>Hiring drives</h1>
          <p className="muted" style={{ margin: 0 }}>
            Share an apply link; candidates take a proctored coding test and land in your pipeline ranked by score.
          </p>
        </div>
        {!creating && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            New drive
          </button>
        )}
      </div>
      {creating && (
        <NewDrive
          onDone={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Drive</th>
                <th>Window</th>
                <th>Applied</th>
                <th>Tested</th>
                <th>Shortlisted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.drives.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => router.push(`/console/drives/${d.id}`)}>
                  <td>
                    <b>{d.title}</b>
                    <div className="muted small">{d.roleTitle}</div>
                  </td>
                  <td className="small muted">
                    {formatDate(d.openAt)} to {formatDate(d.closeAt)}
                  </td>
                  <td>{d.candidates}</td>
                  <td>{d.tested}</td>
                  <td>{d.shortlisted}</td>
                  <td>
                    <span className={`pill ${d.status === "open" ? "good" : ""}`}>{d.status === "open" ? "Open" : "Closed"}</span>
                  </td>
                </tr>
              ))}
              {data?.drives.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted center">
                    No drives yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
