// SQL questions run in an in-memory SQLite database inside the same sandbox
// as code, through this small Python harness. The schema loads first, then
// the connection is made read-only and ATTACH is refused before the
// student's single statement runs.

export const SQL_HARNESS = String.raw`
import json, sqlite3, sys
req = json.load(sys.stdin)
con = sqlite3.connect(":memory:")
try:
    con.executescript(req["schema"])
except Exception as e:
    print(json.dumps({"ok": False, "error": "schema: " + str(e)}))
    sys.exit(0)
con.execute("PRAGMA query_only = ON")
def guard(action, a, b, c, d):
    return sqlite3.SQLITE_DENY if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH) else sqlite3.SQLITE_OK
con.set_authorizer(guard)
try:
    cur = con.execute(req["query"])
    cols = [d[0] for d in cur.description] if cur.description else []
    rows = cur.fetchmany(1001)
    print(json.dumps({"ok": True, "columns": cols, "rows": [list(r) for r in rows]}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`;

export interface SqlResult {
  ok: boolean;
  columns: string[];
  rows: (string | number | null)[][];
  error?: string;
  truncated?: boolean;
}

export function parseSqlOutput(stdout: string): SqlResult {
  try {
    const parsed = JSON.parse(stdout.trim()) as { ok: boolean; columns?: string[]; rows?: (string | number | null)[][]; error?: string };
    const rows = parsed.rows ?? [];
    return { ok: parsed.ok, columns: parsed.columns ?? [], rows: rows.slice(0, 1000), error: parsed.error, truncated: rows.length > 1000 };
  } catch {
    return { ok: false, columns: [], rows: [], error: "The query could not be run" };
  }
}
