"use client";

import { useState } from "react";
import { CHECKLIST_ITEMS, type ChecklistItem } from "@playcode/core";
import { useMe } from "@/components/Auth";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Row {
  id: string;
  name: string;
  rollNo: string | null;
  unit: string | null;
  done: number;
  total: number;
  missing: ChecklistItem[];
  drives: { eligible: number; registered: number };
  sittingOut: boolean;
}
interface Data {
  students: Row[];
  summary: { students: number; ready: number; missing: Record<ChecklistItem, number>; sittingOut: number };
}

const ITEMS = Object.keys(CHECKLIST_ITEMS) as ChecklistItem[];

export default function ReadinessPage() {
  const me = useMe();
  const manage = me.permissions.includes("placements.manage");
  const units = useApi<{ units: { id: string; name: string; kind: string }[] }>("/console/org-units");
  const [unitId, setUnitId] = useState("");
  const { data, error, loading, reload } = useApi<Data>(`/console/readiness${unitId ? `?unitId=${unitId}` : ""}`);
  const [view, setView] = useState<"all" | "sitting" | ChecklistItem>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const list = data.students.filter((s) => (view === "all" ? true : view === "sitting" ? s.sittingOut : s.missing.includes(view)));
  const allSelected = list.length > 0 && list.every((s) => selected.includes(s.id));
  async function nudge(about: "checklist" | "drives") {
    setMsg(null);
    try {
      const r = await api<{ sent: number }>("/console/readiness/nudge", { body: { userIds: selected, about } });
      setMsg(`Reminded ${r.sent} student${r.sent === 1 ? "" : "s"}${r.sent < selected.length ? " (the rest were reminded today already, or have nothing left)" : ""}.`);
      setSelected([]);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const tile = (key: typeof view, label: string, n: number, tone = "") => (
    <button key={key} className="card tight stack" style={{ gap: 2, textAlign: "left", borderColor: view === key ? "var(--accent)" : undefined, cursor: "pointer" }} aria-pressed={view === key} onClick={() => setView(view === key ? "all" : key)}>
      <span style={{ fontSize: 24, fontWeight: 700, color: tone || undefined }}>{n}</span>
      <span className="small muted">{label}</span>
    </button>
  );
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1180 }}>
      <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Placement readiness</h1>
          <p className="muted" style={{ margin: 0 }}>
            {data.summary.ready} of {data.summary.students} students have everything ready. Pick a gap to see who has it.
          </p>
        </div>
        <div>
          <label htmlFor="r-unit">Batch or section</label>
          <select id="r-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Everyone</option>
            {(units.data?.units ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {ITEMS.map((k) => tile(k, `missing: ${CHECKLIST_ITEMS[k].label.toLowerCase()}`, data.summary.missing[k]))}
        {tile("sitting", "sitting the season out (eligible for 2+ drives, registered for none)", data.summary.sittingOut, "var(--bad-ink)")}
      </div>
      {manage && (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="small muted">{selected.length} selected</span>
          <button className="btn small" disabled={!selected.length} onClick={() => nudge("checklist")}>
            Remind them what&apos;s missing
          </button>
          <button className="btn small" disabled={!selected.length} onClick={() => nudge("drives")}>
            Remind them about drives
          </button>
          {msg && (
            <span className="small" role="status">
              {msg}
            </span>
          )}
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {manage && (
                  <th>
                    <input type="checkbox" style={{ width: "auto" }} aria-label="Select everyone shown" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? list.map((s) => s.id) : [])} />
                  </th>
                )}
                <th>Student</th>
                <th>Ready</th>
                <th>Missing</th>
                <th>Drives</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  {manage && (
                    <td>
                      <input type="checkbox" style={{ width: "auto" }} aria-label={`Select ${s.name}`} checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
                    </td>
                  )}
                  <td>
                    <a href={`/console/students/${s.id}`}>{s.name}</a>
                    <div className="small muted">{[s.rollNo, s.unit].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td style={{ minWidth: 120 }}>
                    <div className="small">
                      {s.done} of {s.total}
                    </div>
                    <div className={`bar ${s.missing.length ? (s.done / (s.total || 1) < 0.5 ? "bad" : "warn") : "good"}`} aria-hidden>
                      <span style={{ width: `${Math.round((s.done / (s.total || 1)) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="small">{s.missing.length ? s.missing.map((k) => CHECKLIST_ITEMS[k].label).join(", ") : <span className="pill good">Ready</span>}</td>
                  <td className="small">
                    {s.drives.registered} of {s.drives.eligible} eligible
                    {s.sittingOut && (
                      <div>
                        <span className="pill bad">Sitting out</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <div className="muted" style={{ padding: 16 }}>Nobody here.</div>}
      </div>
    </div>
  );
}
