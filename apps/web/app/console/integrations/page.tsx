"use client";

import { useState, type FormEvent } from "react";
import { ErrorBox, formatDate, Loading, timeAgo } from "@/components/ui";
import { API_URL, api, errorMessage, useApi } from "@/lib/api";

interface Client {
  id: string;
  name: string;
  clientId: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
interface Hook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  stats: { delivered: number; pending: number; failed: number };
}
interface Delivery {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
}

const SCOPE_LABELS: Record<string, string> = {
  "users:read": "Read students and batches",
  "users:write": "Create and disable students",
  "assignments:read": "Read assignments",
  "assignments:write": "Create assignments",
  "results:read": "Read results and readiness",
};

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div className="card tight stack" style={{ background: "var(--warn-soft)", borderColor: "transparent", gap: 4 }}>
      <b>{label}: copy it now, it will not be shown again</b>
      <code className="inline-code" style={{ wordBreak: "break-all" }}>
        {value}
      </code>
    </div>
  );
}

function Clients() {
  const { data, reload } = useApi<{ clients: Client[]; scopes: string[] }>("/console/api-clients");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["users:read", "results:read"]);
  const [secret, setSecret] = useState<{ clientId: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ client: Client; clientSecret: string }>("/console/api-clients", { body: { name, scopes } });
      setSecret({ clientId: r.client.clientId, secret: r.clientSecret });
      setName("");
      void reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>API clients</h2>
      <p className="muted small" style={{ margin: 0 }}>
        For your ERP, LMS or ATS. Exchange the client ID and secret for an access token at <code className="inline-code">POST {API_URL}/v1/oauth/token</code>.
      </p>
      {secret && (
        <>
          <Secret label="Client ID" value={secret.clientId} />
          <Secret label="Client secret" value={secret.secret} />
        </>
      )}
      <form className="stack" onSubmit={create} style={{ gap: 8 }}>
        <input aria-label="Client name" placeholder="e.g. College ERP" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="row wrap" style={{ gap: 6 }}>
          {data?.scopes.map((s) => (
            <button type="button" key={s} className={`btn small ${scopes.includes(s) ? "primary" : ""}`} onClick={() => setScopes(scopes.includes(s) ? scopes.filter((x) => x !== s) : [...scopes, s])}>
              {SCOPE_LABELS[s] ?? s}
            </button>
          ))}
        </div>
        {error && <ErrorBox message={error} />}
        <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!name || !scopes.length}>
          Create client
        </button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Client ID</th>
            <th>Access</th>
            <th>Last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.clients.map((c) => (
            <tr key={c.id} style={{ opacity: c.revokedAt ? 0.5 : 1 }}>
              <td>
                <b>{c.name}</b>
              </td>
              <td className="small" style={{ fontFamily: "var(--mono)" }}>
                {c.clientId}
              </td>
              <td className="small">{c.scopes.join(", ")}</td>
              <td className="small muted">{c.revokedAt ? "revoked" : timeAgo(c.lastUsedAt)}</td>
              <td>
                {!c.revokedAt && (
                  <button className="btn small" onClick={() => api(`/console/api-clients/${c.id}/revoke`, { body: {} }).then(reload)}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Deliveries({ hookId }: { hookId: string }) {
  const { data, reload } = useApi<{ deliveries: Delivery[] }>(`/console/webhooks/${hookId}/deliveries`);
  if (!data) return <Loading />;
  return (
    <table className="small">
      <tbody>
        {data.deliveries.map((d) => (
          <tr key={d.id}>
            <td className="muted">{formatDate(d.createdAt)}</td>
            <td style={{ fontFamily: "var(--mono)" }}>{d.event}</td>
            <td>
              <span className={`pill ${d.status === "delivered" ? "good" : d.status === "failed" ? "bad" : "warn"}`}>{d.status}</span>
            </td>
            <td className="muted">
              {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
              {d.lastError ? ` · ${d.lastError}` : ""}
            </td>
            <td>
              {d.status !== "delivered" && (
                <button className="btn small" onClick={() => api(`/console/webhooks/${hookId}/deliveries/${d.id}/retry`, { body: {} }).then(reload)}>
                  Retry now
                </button>
              )}
            </td>
          </tr>
        ))}
        {data.deliveries.length === 0 && (
          <tr>
            <td className="muted">No deliveries yet.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Webhooks() {
  const { data, reload } = useApi<{ webhooks: Hook[]; events: string[] }>("/console/webhooks");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["assessment.submitted", "assignment.completed"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ signingSecret: string }>("/console/webhooks", { body: { url, events } });
      setSecret(r.signingSecret);
      setUrl("");
      void reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function test(id: string) {
    const r = await api<{ result: { delivered: number } }>(`/console/webhooks/${id}/test`, { body: {} });
    setTestMsg(r.result.delivered ? "Test event delivered" : "Test event failed; see deliveries for the error");
    void reload();
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Webhooks</h2>
      <p className="muted small" style={{ margin: 0 }}>
        PlayCode POSTs JSON to your URL when something happens. Check the <code className="inline-code">X-PlayCode-Signature</code> header: <code className="inline-code">t=&lt;unix time&gt;,v1=HMAC-SHA256(secret, &quot;t.body&quot;)</code>. Failed deliveries retry for about an hour.
      </p>
      {secret && <Secret label="Signing secret" value={secret} />}
      <form className="stack" onSubmit={create} style={{ gap: 8 }}>
        <input aria-label="Webhook URL" placeholder="https://erp.example.edu/playcode-events" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <div className="row wrap" style={{ gap: 6 }}>
          {data?.events.map((ev) => (
            <button type="button" key={ev} className={`btn small ${events.includes(ev) ? "primary" : ""}`} onClick={() => setEvents(events.includes(ev) ? events.filter((x) => x !== ev) : [...events, ev])}>
              {ev}
            </button>
          ))}
        </div>
        {error && <ErrorBox message={error} />}
        <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!url || !events.length}>
          Add webhook
        </button>
      </form>
      {testMsg && <span className="pill accent">{testMsg}</span>}
      {data?.webhooks.map((h) => (
        <div key={h.id} className="card tight stack" style={{ gap: 6 }}>
          <div className="spread wrap">
            <div>
              <b style={{ fontFamily: "var(--mono)", fontSize: "0.9rem" }}>{h.url}</b>
              <div className="muted small">
                {h.events.join(", ")} · {h.stats.delivered} delivered, {h.stats.pending} pending, {h.stats.failed} failed
              </div>
            </div>
            <div className="row">
              <button className="btn small" onClick={() => test(h.id)}>
                Send test
              </button>
              <button className="btn small" onClick={() => api(`/console/webhooks/${h.id}`, { method: "PUT", body: { active: !h.active } }).then(reload)}>
                {h.active ? "Pause" : "Resume"}
              </button>
              <button className="btn small" onClick={() => setOpen(open === h.id ? null : h.id)}>
                {open === h.id ? "Hide" : "Deliveries"}
              </button>
              <button className="btn small" style={{ color: "var(--bad)" }} onClick={() => api(`/console/webhooks/${h.id}`, { method: "DELETE" }).then(reload)}>
                Delete
              </button>
            </div>
          </div>
          {open === h.id && <Deliveries hookId={h.id} />}
        </div>
      ))}
    </div>
  );
}

export default function Integrations() {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1 style={{ margin: 0 }}>Integrations</h1>
        <p className="muted" style={{ margin: 0 }}>
          Connect PlayCode to your ERP, LMS or hiring system. API reference: GET /v1/users, POST /v1/users, GET /v1/org-units, POST /v1/assignments, GET /v1/results, GET /v1/readiness, GET /v1/students/:id.
        </p>
      </div>
      <Clients />
      <Webhooks />
    </div>
  );
}
