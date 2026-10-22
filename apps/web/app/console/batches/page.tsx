"use client";

import { useState, type FormEvent } from "react";
import { useMe } from "@/components/Auth";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import type { OrgUnit } from "@/lib/types";

interface ImportResult {
  created: { name: string; email: string; rollNo: string | null; password: string }[];
  skipped: { email: string; reason: string }[];
}

function depthSorted(units: OrgUnit[]) {
  const ids = new Set(units.map((u) => u.id));
  const out: (OrgUnit & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of units.filter((x) => (x.parentId && ids.has(x.parentId) ? x.parentId : null) === parent)) {
      out.push({ ...u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default function Batches() {
  const me = useMe();
  const canManage = me.permissions.includes("users.manage");
  const { data, error, loading, reload } = useApi<{ units: OrgUnit[] }>("/console/org-units");
  const units = depthSorted(data?.units ?? []);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<OrgUnit["kind"]>("section");
  const [parentId, setParentId] = useState("");
  const [unitError, setUnitError] = useState<string | null>(null);

  const [importUnit, setImportUnit] = useState("");
  const [csv, setCsv] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addUnit(e: FormEvent) {
    e.preventDefault();
    setUnitError(null);
    try {
      await api("/console/org-units", { body: { name, kind, parentId: parentId || null } });
      setName("");
      void reload();
    } catch (err) {
      setUnitError(errorMessage(err));
    }
  }

  async function importStudents(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setImportError(null);
    setResult(null);
    try {
      const r = await api<ImportResult>("/console/students/import", { body: { unitId: importUnit, csv, ...(password ? { defaultPassword: password } : {}) } });
      setResult(r);
      setCsv("");
      void reload();
    } catch (err) {
      setImportError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function downloadCredentials() {
    if (!result) return;
    const text = ["name,email,roll_no,password", ...result.created.map((c) => [c.name, c.email, c.rollNo ?? "", c.password].join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = "playcode-new-student-logins.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1 style={{ margin: 0 }}>Batches and sections</h1>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Students</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td style={{ paddingLeft: 8 + u.depth * 20, fontWeight: u.depth === 0 ? 700 : 500 }}>{u.name}</td>
                  <td className="muted small">{u.kind}</td>
                  <td>{u.students || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
          <form className="card stack" onSubmit={addUnit}>
            <h2 style={{ margin: 0 }}>Add a department, batch or section</h2>
            <div>
              <label htmlFor="unit-name">Name</label>
              <input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CSE 2028 - A" required />
            </div>
            <div className="row">
              <div style={{ flex: 1 }}>
                <label htmlFor="unit-kind">Type</label>
                <select id="unit-kind" value={kind} onChange={(e) => setKind(e.target.value as OrgUnit["kind"])}>
                  <option value="department">Department</option>
                  <option value="batch">Batch</option>
                  <option value="section">Section</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="unit-parent">Inside</label>
                <select id="unit-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">(top level)</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {unitError && <ErrorBox message={unitError} />}
            <button className="btn primary">Add</button>
          </form>

          <form className="card stack" onSubmit={importStudents}>
            <h2 style={{ margin: 0 }}>Import students</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Paste rows of <code>name,email,roll_no</code> from Excel or your ERP. Existing emails are skipped.
            </p>
            <div>
              <label htmlFor="import-unit">Into section</label>
              <select id="import-unit" value={importUnit} onChange={(e) => setImportUnit(e.target.value)} required>
                <option value="">Choose a section</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="csv">Students</label>
              <textarea id="csv" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"name,email,roll_no\nAsha Rao,asha.rao@college.edu,CSE28A001"} required />
            </div>
            <div>
              <label htmlFor="pw">Starting password (optional)</label>
              <input id="pw" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to generate one per student" minLength={8} />
            </div>
            {importError && <ErrorBox message={importError} />}
            <button className="btn primary" disabled={busy}>
              {busy ? "Importing..." : "Import"}
            </button>
            {result && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="pill good">
                  {result.created.length} created, {result.skipped.length} skipped
                </div>
                {result.created.length > 0 && (
                  <button type="button" className="btn small" onClick={downloadCredentials}>
                    Download logins (CSV)
                  </button>
                )}
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
