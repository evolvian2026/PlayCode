"use client";

import { useApi } from "@/lib/api";
import type { OrgUnit } from "@/lib/types";

/** Units in the user's scope, indented by depth. */
export function useUnits() {
  const { data } = useApi<{ units: OrgUnit[] }>("/console/org-units");
  const units = data?.units ?? [];
  const byParent = new Map<string | null, OrgUnit[]>();
  const ids = new Set(units.map((u) => u.id));
  for (const u of units) {
    // Units whose parent is out of scope show as roots.
    const parent = u.parentId && ids.has(u.parentId) ? u.parentId : null;
    (byParent.get(parent) ?? byParent.set(parent, []).get(parent)!).push(u);
  }
  const ordered: (OrgUnit & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of byParent.get(parent) ?? []) {
      ordered.push({ ...u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return ordered;
}

export function UnitPicker({ value, onChange, allLabel = "All my students" }: { value: string; onChange: (v: string) => void; allLabel?: string }) {
  const units = useUnits();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Batch or section" style={{ maxWidth: 280 }}>
      <option value="">{allLabel}</option>
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {"  ".repeat(u.depth)}
          {u.name}
        </option>
      ))}
    </select>
  );
}
