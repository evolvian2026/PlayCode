"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DIVISION_LABELS, type Division } from "@playcode/core";
import { UnitPicker } from "@/components/UnitPicker";
import { ErrorBox, Loading, timeAgo } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Row {
  id: string;
  name: string;
  email: string;
  rollNo: string | null;
  unitName: string | null;
  xp: number;
  level: number;
  streak: number;
  division: Division;
  answersLast7Days: number;
  lastActiveAt: string | null;
  readiness: Record<string, number>;
}

type SortKey = "name" | "xp" | "streak" | "answersLast7Days" | "service" | "product";

function readinessPill(score: number | undefined) {
  const s = score ?? 0;
  const cls = s >= 70 ? "good" : s >= 50 ? "accent" : s >= 30 ? "warn" : "bad";
  return <span className={`pill ${cls}`}>{s}</span>;
}

export default function Students() {
  const router = useRouter();
  const [unitId, setUnitId] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const { data, error, loading, reload } = useApi<{ students: Row[] }>(`/console/students${unitId ? `?unitId=${unitId}` : ""}`);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = (data?.students ?? []).filter((s) => !term || `${s.name} ${s.email} ${s.rollNo ?? ""}`.toLowerCase().includes(term));
    const val = (s: Row) => (sort === "service" || sort === "product" ? (s.readiness[sort] ?? 0) : s[sort]);
    return [...list].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : Number(val(b)) - Number(val(a))));
  }, [data, search, sort]);

  const exportCsv = () => {
    const header = "name,email,roll_no,section,xp,level,streak,answers_7d,service_readiness,product_readiness";
    const lines = rows.map((s) =>
      [s.name, s.email, s.rollNo ?? "", s.unitName ?? "", s.xp, s.level, s.streak, s.answersLast7Days, s.readiness.service ?? 0, s.readiness.product ?? 0]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "playcode-students.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const th = (key: SortKey, label: string) => (
    <th>
      <button className="btn ghost small" style={{ padding: 0, color: sort === key ? "var(--accent)" : undefined }} onClick={() => setSort(key)}>
        {label}
      </button>
    </th>
  );

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <h1 style={{ margin: 0 }}>Students</h1>
        <div className="row">
          <UnitPicker value={unitId} onChange={setUnitId} />
          <button className="btn small" onClick={exportCsv} disabled={!rows.length}>
            Export CSV
          </button>
        </div>
      </div>
      <input placeholder="Search by name, email or roll number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search students" />
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                {th("name", "Student")}
                <th>Section</th>
                {th("xp", "XP / level")}
                {th("streak", "Streak")}
                {th("answersLast7Days", "Answers 7d")}
                {th("service", "Service ready")}
                {th("product", "Product ready")}
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => router.push(`/console/students/${s.id}`)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    <div className="muted small">{s.rollNo ?? s.email}</div>
                  </td>
                  <td className="small">{s.unitName}</td>
                  <td>
                    {s.xp} <span className="muted small">· L{s.level} · {DIVISION_LABELS[s.division]}</span>
                  </td>
                  <td>{s.streak}</td>
                  <td>{s.answersLast7Days}</td>
                  <td>{readinessPill(s.readiness.service)}</td>
                  <td>{readinessPill(s.readiness.product)}</td>
                  <td className="small muted">{timeAgo(s.lastActiveAt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted center">
                    No students found.
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
