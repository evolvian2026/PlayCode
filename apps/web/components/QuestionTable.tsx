import type { DataTable } from "@playcode/core";

/** The table a data-interpretation question asks about. Numbers line up on the right; it scrolls sideways on a narrow screen. */
export function QuestionTable({ table }: { table?: DataTable | null }) {
  if (!table) return null;
  return (
    <div className="table-wrap">
      <table style={{ fontVariantNumeric: "tabular-nums" }}>
        <caption className="small muted" style={{ textAlign: "left", paddingBottom: 4 }}>
          {table.caption}
        </caption>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} scope="col" style={i ? { textAlign: "right" } : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map(([head, ...cells]) => (
            <tr key={head}>
              <th scope="row" style={{ textTransform: "none", letterSpacing: 0, fontSize: "0.92rem", color: "var(--text)" }}>
                {head}
              </th>
              {cells.map((c, i) => (
                <td key={i} style={{ textAlign: "right" }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
