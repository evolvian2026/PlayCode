"use client";

import { useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { useUnits } from "@/components/UnitPicker";
import { api, errorMessage, useApi } from "@/lib/api";

interface Sheet {
  mentors: { id: string; name: string; mentees: number }[];
  students: { id: string; name: string; rollNo: string | null; mentorId: string | null }[];
}

export default function MentorAssignment() {
  const units = useUnits();
  const [unitId, setUnitId] = useState("");
  const { data, error, loading, reload } = useApi<Sheet>(unitId ? `/console/mentoring/assign?unitId=${unitId}` : null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [splitWith, setSplitWith] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(path: string, body: object, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/console/mentoring/${path}`, { body });
      setSelected(new Set());
      setMsg(done);
      await reload();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const name = (id: string | null) => data?.mentors.find((m) => m.id === id)?.name ?? "-";
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
      <div>
        <h1 style={{ margin: 0 }}>Mentor assignment</h1>
        <p className="muted" style={{ margin: 0 }}>
          Give every student a faculty mentor. Split a section into roll-number blocks, or assign students by hand. Mentors see their mentees under My mentees.
        </p>
      </div>
      <select aria-label="Batch or section" value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ width: "auto", maxWidth: 320 }}>
        <option value="">Choose a section</option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {"  ".repeat(u.depth)}
            {u.name}
          </option>
        ))}
      </select>
      {msg && (
        <div className="small" role="status">
          {msg}
        </div>
      )}
      {!unitId ? null : loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />
      ) : (
        <>
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Split this section</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Choose mentors in the order their blocks should go. {data.students.length} students will be shared out by roll number, replacing their current mentors.
            </p>
            <div className="row wrap" style={{ gap: 6 }}>
              {data.mentors.map((m) => {
                const i = splitWith.indexOf(m.id);
                return (
                  <button key={m.id} type="button" className={`btn small ${i >= 0 ? "primary" : ""}`} aria-pressed={i >= 0} onClick={() => setSplitWith(i >= 0 ? splitWith.filter((x) => x !== m.id) : [...splitWith, m.id])}>
                    {i >= 0 ? `${i + 1}. ` : ""}
                    {m.name} <span className={i >= 0 ? undefined : "muted"}>({m.mentees})</span>
                  </button>
                );
              })}
            </div>
            <button
              className="btn primary small"
              style={{ alignSelf: "flex-start" }}
              disabled={busy || !splitWith.length || !data.students.length}
              onClick={() => run("split", { unitId, mentorIds: splitWith }, `Split ${data.students.length} students between ${splitWith.length} mentors.`)}
            >
              Split between {splitWith.length || "the chosen"} mentor{splitWith.length === 1 ? "" : "s"}
            </button>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="spread wrap" style={{ padding: "12px 16px", gap: 8 }}>
              <h2 style={{ margin: 0 }}>Students</h2>
              <div className="row wrap">
                <select aria-label="Mentor for the selected students" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: "auto" }}>
                  <option value="">Assign selected to...</option>
                  {data.mentors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button className="btn small" disabled={busy || !target || !selected.size} onClick={() => run("assign", { mentorId: target, studentIds: [...selected] }, `Assigned ${selected.size} students to ${name(target)}.`)}>
                  Assign {selected.size || ""}
                </button>
                <button className="btn ghost small" disabled={busy || !selected.size} onClick={() => run("unassign", { studentIds: [...selected] }, `Removed the mentor from ${selected.size} students.`)}>
                  Remove mentor
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={selected.size === data.students.length && data.students.length > 0}
                        onChange={(e) => setSelected(e.target.checked ? new Set(data.students.map((s) => s.id)) : new Set())}
                        style={{ width: "auto" }}
                      />
                    </th>
                    <th>Roll no</th>
                    <th>Student</th>
                    <th>Mentor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${s.name}`}
                          checked={selected.has(s.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(s.id);
                            else next.delete(s.id);
                            setSelected(next);
                          }}
                          style={{ width: "auto" }}
                        />
                      </td>
                      <td className="small">{s.rollNo ?? "-"}</td>
                      <td>{s.name}</td>
                      <td className={s.mentorId ? "" : "muted"}>{s.mentorId ? name(s.mentorId) : "None yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
