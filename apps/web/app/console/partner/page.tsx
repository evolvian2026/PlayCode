"use client";

import { useState, type FormEvent } from "react";
import { switchTenant } from "@/components/Auth";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

interface Overview {
  partner: { id: string; name: string };
  seats: { total: number; allocated: number; available: number };
  tenants: { id: string; name: string; slug: string; type: string; plan: string; seats: number; validUntil: string | null; studentsUsed: number; activeLast7Days: number }[];
}

export default function Partner() {
  const { data, error, loading, reload } = useApi<Overview>("/admin/partner/overview");
  const [form, setForm] = useState({ name: "", slug: "", type: "institution", seats: 100, adminName: "", adminEmail: "", adminPassword: "" });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [seatEdit, setSeatEdit] = useState<Record<string, number>>({});
  const [rowError, setRowError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await api("/admin/tenants", {
        body: { name: form.name, slug: form.slug, type: form.type, seats: form.seats, admin: { name: form.adminName, email: form.adminEmail, password: form.adminPassword } },
      });
      setCreating(false);
      void reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  async function saveSeats(id: string) {
    setRowError(null);
    try {
      await api(`/admin/tenants/${id}`, { method: "PUT", body: { seats: seatEdit[id] } });
      setSeatEdit(({ [id]: _, ...rest }) => rest);
      void reload();
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: k === "seats" ? Number(e.target.value) : e.target.value });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <div>
          <h1 style={{ margin: 0 }}>Colleges and companies</h1>
          <p className="muted" style={{ margin: 0 }}>
            {data.partner.name} · your branding applies to every college below unless they set their own.
          </p>
        </div>
        {!creating && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            Add college or company
          </button>
        )}
      </div>
      <div className="grid">
        <Stat label="Seat pool" value={data.seats.total} />
        <Stat label="Allocated" value={data.seats.allocated} />
        <Stat label="Available" value={data.seats.available} />
        <Stat label="Students using seats" value={data.tenants.reduce((a, t) => a + t.studentsUsed, 0)} />
      </div>
      {creating && (
        <form className="card stack" onSubmit={create}>
          <h2 style={{ margin: 0 }}>New college or company</h2>
          <div className="row wrap">
            <input aria-label="Name" placeholder="Name" value={form.name} onChange={set("name")} required style={{ flex: 2, minWidth: 200 }} />
            <input aria-label="Short name" placeholder="short-name (for the sign-in link)" value={form.slug} onChange={set("slug")} pattern="[a-z0-9-]{3,40}" required style={{ flex: 1, minWidth: 160 }} />
            <select aria-label="Type" value={form.type} onChange={set("type")} style={{ width: 160 }}>
              <option value="institution">College</option>
              <option value="company">Company</option>
            </select>
            <input aria-label="Seats" type="number" min={1} max={data.seats.available} value={form.seats} onChange={set("seats")} style={{ width: 120 }} />
          </div>
          <div className="row wrap">
            <input aria-label="Admin name" placeholder="Admin name" value={form.adminName} onChange={set("adminName")} required style={{ flex: 1, minWidth: 160 }} />
            <input aria-label="Admin email" type="email" placeholder="Admin email" value={form.adminEmail} onChange={set("adminEmail")} required style={{ flex: 1, minWidth: 200 }} />
            <input aria-label="Starting password" placeholder="Starting password (8+)" value={form.adminPassword} onChange={set("adminPassword")} minLength={8} required style={{ flex: 1, minWidth: 160 }} />
          </div>
          {formError && <ErrorBox message={formError} />}
          <div className="row">
            <button className="btn primary">Create</button>
            <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {rowError && <ErrorBox message={rowError} />}
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Seats used</th>
              <th>Active 7d</th>
              <th>Seats</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.tenants.map((t) => (
              <tr key={t.id}>
                <td>
                  <b>{t.name}</b>
                  <div className="muted small">/login?org={t.slug}</div>
                </td>
                <td className="small">{t.type === "company" ? "Company" : "College"}</td>
                <td>{t.studentsUsed}</td>
                <td>{t.activeLast7Days}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <input type="number" aria-label={`Seats for ${t.name}`} value={seatEdit[t.id] ?? t.seats} onChange={(e) => setSeatEdit({ ...seatEdit, [t.id]: Number(e.target.value) })} style={{ width: 100 }} />
                    {seatEdit[t.id] !== undefined && seatEdit[t.id] !== t.seats && (
                      <button className="btn small" onClick={() => saveSeats(t.id)}>
                        Save
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  <button className="btn small primary" onClick={() => void switchTenant(t.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {data.tenants.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center">
                  No colleges yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
