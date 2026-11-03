"use client";

import { useEffect, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

interface Entry {
  id: string;
  action: string;
  target: string | null;
  data: Record<string, unknown>;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
}

interface Page {
  entries: Entry[];
  nextCursor: string | null;
  actions: string[];
}

export default function AuditLog() {
  const [action, setAction] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean, from: string | null) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "50", ...(action ? { action } : {}), ...(from ? { cursor: from } : {}) });
      const page = await api<Page>(`/console/audit?${qs}`);
      setEntries((prev) => (reset ? page.entries : [...prev, ...page.entries]));
      setActions(page.actions);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <h1 style={{ margin: 0 }}>Audit log</h1>
        <select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} style={{ width: "auto", minWidth: 220 }}>
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Every sensitive change in your institution: imports, settings, test reviews, API keys, single sign-on and privacy requests.
      </p>
      {error && <ErrorBox message={error} onRetry={() => load(true, null)} />}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="small" style={{ whiteSpace: "nowrap" }}>
                  {new Date(e.at).toLocaleString()}
                </td>
                <td className="small">{e.actorName ? <span title={e.actorEmail ?? ""}>{e.actorName}</span> : <span className="muted">System</span>}</td>
                <td>
                  <code className="inline-code">{e.action}</code>
                </td>
                <td className="small muted" style={{ maxWidth: 420, overflowWrap: "anywhere" }}>
                  {Object.keys(e.data).length ? JSON.stringify(e.data) : (e.target ?? "")}
                </td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Nothing logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <Loading />}
      {cursor && !loading && (
        <button className="btn" style={{ alignSelf: "center" }} onClick={() => load(false, cursor)}>
          Load older entries
        </button>
      )}
    </div>
  );
}
