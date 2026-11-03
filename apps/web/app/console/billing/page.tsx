"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import { formatRupees } from "@playcode/core";
import { useMe } from "@/components/Auth";
import { Bar, ErrorBox, Loading, Stat } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

interface Invoice {
  id: string;
  number: string;
  period: string;
  plan: string;
  totalPaise: number;
  status: "issued" | "paid" | "void";
  paidVia: "razorpay" | "manual" | null;
  issuedAt: string;
  dueAt: string;
  tenantName?: string;
  amountDuePaise: number;
  creditNotes: { id: string; number: string; totalPaise: number; reason: string; refundId: string | null; issuedAt: string }[];
}

/** PlayCode staff: issue a credit note (and refund an online payment) against an invoice. */
function CreditNoteForm({ invoice, onDone }: { invoice: Invoice; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/billing/invoices/${invoice.id}/credit-notes`, { body: { subtotalPaise: Math.round(Number(amount) * 100), reason, refund } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit} style={{ gap: 6, padding: "8px 0" }}>
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        <div style={{ width: 170 }}>
          <label htmlFor={`cn-amount-${invoice.id}`} className="small">
            Amount before GST (Rs)
          </label>
          <input id={`cn-amount-${invoice.id}`} type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor={`cn-reason-${invoice.id}`} className="small">
            Reason (printed on the credit note)
          </label>
          <input id={`cn-reason-${invoice.id}`} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required placeholder="e.g. 50 seats removed from 1 October" />
        </div>
      </div>
      {invoice.status === "paid" && invoice.paidVia === "razorpay" && (
        <label className="row small" style={{ gap: 6, fontWeight: 500 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={refund} onChange={(e) => setRefund(e.target.checked)} /> Refund it to the original online payment (Razorpay)
        </label>
      )}
      {error && <ErrorBox message={error} />}
      <button className="btn small primary" style={{ alignSelf: "flex-start" }} disabled={busy}>
        Issue credit note
      </button>
    </form>
  );
}

interface BillingInfo {
  usage: {
    plan: string;
    planName: string;
    seatPricePaise: number;
    billedByPartner: boolean;
    seats: { licensed: number; used: number };
    validUntil: string | null;
    ai: { tokensThisMonth: number; allowance: number; overagePerMillionPaise: number };
    features: { id: string; label: string; included: boolean }[];
  };
  profile: { legalName: string; gstin: string | null; address: string; stateCode: string | null; email: string } | null;
  invoices: Invoice[];
  onlinePayments: boolean;
}

const STATUS_TONE = { issued: "warn", paid: "good", void: "" } as const;
const millions = (n: number) => `${(n / 1_000_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })}M`;

async function downloadPdf(path: string, name: string) {
  const url = await fetchObjectUrl(path);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function InvoiceTable({ invoices, admin, onlinePayments = false, onChange }: { invoices: Invoice[]; admin: boolean; onlinePayments?: boolean; onChange?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [crediting, setCrediting] = useState<string | null>(null);
  async function pay(id: string) {
    setPaying(id);
    setError(null);
    try {
      // Razorpay's payment page; it sends the browser back to /console/billing/paid.
      window.location.href = (await api<{ url: string }>(`/console/billing/invoices/${id}/pay`, { body: {} })).url;
    } catch (e) {
      setError(errorMessage(e));
      setPaying(null);
    }
  }
  if (invoices.length === 0) return <div className="muted small">No invoices yet.</div>;
  async function mark(id: string, status: "paid" | "void") {
    try {
      await api(`/admin/billing/invoices/${id}/status`, { body: { status } });
      onChange?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="table-wrap">
      {error && <ErrorBox message={error} />}
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            {admin && <th>Customer</th>}
            <th>Period</th>
            <th>Total (incl. GST)</th>
            <th>Due</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <Fragment key={i.id}>
            <tr>
              <td style={{ whiteSpace: "nowrap" }}>
                {i.number}
                <div className="small muted">due {new Date(i.dueAt).toLocaleDateString()}</div>
              </td>
              {admin && <td>{i.tenantName}</td>}
              <td>{i.period}</td>
              <td>{formatRupees(i.totalPaise)}</td>
              <td>{i.status === "issued" ? formatRupees(i.amountDuePaise) : "-"}</td>
              <td>
                <span className={`pill ${STATUS_TONE[i.status]}`}>{i.status === "paid" && i.paidVia === "razorpay" ? "paid online" : i.status}</span>
              </td>
              <td>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn small" onClick={() => downloadPdf(`${admin ? "/admin" : "/console"}/billing/invoices/${i.id}/pdf`, `${i.number.replace(/\//g, "-")}.pdf`)}>
                    PDF
                  </button>
                  {!admin && onlinePayments && i.status === "issued" && i.amountDuePaise > 0 && (
                  <button className="btn small primary" disabled={paying !== null} onClick={() => pay(i.id)}>
                    {paying === i.id ? "Opening..." : "Pay online"}
                  </button>
                )}
                {admin && i.status === "issued" && (
                    <>
                      <button className="btn small ghost" onClick={() => mark(i.id, "paid")}>
                        Mark paid
                      </button>
                      <button className="btn small ghost" onClick={() => mark(i.id, "void")}>
                        Void
                      </button>
                    </>
                  )}
                  {admin && i.status !== "void" && (
                    <button className="btn small ghost" onClick={() => setCrediting(crediting === i.id ? null : i.id)}>
                      Credit note
                    </button>
                  )}
                </div>
              </td>
            </tr>
            {(i.creditNotes.length > 0 || crediting === i.id) && (
              <tr>
                <td colSpan={admin ? 7 : 6} style={{ paddingTop: 0 }}>
                  {i.creditNotes.map((c) => (
                    <div key={c.id} className="row small" style={{ gap: 8 }}>
                      <span className="muted">Credit note {c.number}: {formatRupees(c.totalPaise)} · {c.reason}{c.refundId ? " · refunded" : ""}</span>
                      <button className="btn small ghost" style={{ padding: "0 4px" }} onClick={() => downloadPdf(`${admin ? "/admin" : "/console"}/billing/credit-notes/${c.id}/pdf`, `${c.number.replace(/\//g, "-")}.pdf`)}>
                        PDF
                      </button>
                    </div>
                  ))}
                  {crediting === i.id && (
                    <CreditNoteForm
                      invoice={i}
                      onDone={() => {
                        setCrediting(null);
                        onChange?.();
                      }}
                    />
                  )}
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** PlayCode staff: issue a month's invoices and track payment. */
function AdminBilling() {
  const lastMonth = (() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();
  const [period, setPeriod] = useState(lastMonth);
  const { data, error, reload } = useApi<{ invoices: Invoice[] }>(`/admin/billing/invoices?period=${period}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  async function run() {
    setRunError(null);
    try {
      const r = await api<{ issued: number }>("/admin/billing/run", { body: { period } });
      setMsg(r.issued ? `Issued ${r.issued} invoices.` : "Every customer already has an invoice for this month.");
      reload();
    } catch (e) {
      setRunError(errorMessage(e));
    }
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <h1 style={{ margin: 0 }}>Invoicing</h1>
      <div className="card row wrap" style={{ alignItems: "flex-end" }}>
        <div>
          <label htmlFor="b-period">Month</label>
          <input id="b-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
        <button className="btn primary" onClick={run}>
          Issue invoices for this month
        </button>
        {msg && <span className="pill good">{msg}</span>}
      </div>
      {runError && <ErrorBox message={runError} />}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      <div className="card">{data ? <InvoiceTable invoices={data.invoices} admin onChange={reload} /> : <Loading />}</div>
    </div>
  );
}

function TenantBilling() {
  const { data, error, loading, reload } = useApi<BillingInfo>("/console/billing");
  const [f, setF] = useState({ legalName: "", gstin: "", address: "", stateCode: "", email: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    const p = data?.profile;
    if (p) setF({ legalName: p.legalName, gstin: p.gstin ?? "", address: p.address, stateCode: p.stateCode ?? "", email: p.email });
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const u = data.usage;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setMsg(null);
    try {
      await api("/console/billing/profile", { method: "PUT", body: { ...f, gstin: f.gstin || null, stateCode: f.stateCode || null } });
      setMsg("Saved. New invoices use these details.");
      reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  }

  const monthly = u.seats.licensed * u.seatPricePaise;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <h1 style={{ margin: 0 }}>Plan &amp; billing</h1>
      <div className="grid">
        <Stat label="Plan" value={u.planName} sub={u.validUntil ? `licence until ${new Date(u.validUntil).toLocaleDateString()}` : undefined} />
        <Stat label="Seats in use" value={`${u.seats.used} / ${u.seats.licensed}`} sub={<Bar value={(u.seats.used / Math.max(1, u.seats.licensed)) * 100} />} />
        <Stat
          label="AI this month"
          value={u.ai.allowance ? `${millions(u.ai.tokensThisMonth)} / ${millions(u.ai.allowance)}` : "Not included"}
          sub={u.ai.allowance ? (u.ai.overagePerMillionPaise ? `then ${formatRupees(u.ai.overagePerMillionPaise)} per million tokens` : "AI pauses at the allowance until the 1st") : undefined}
        />
        <Stat label="Monthly (before GST)" value={u.billedByPartner ? "Via your partner" : formatRupees(monthly)} sub={u.billedByPartner ? undefined : `${formatRupees(u.seatPricePaise)} per seat`} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>What your plan includes</h2>
        <div className="row wrap" style={{ gap: 8 }}>
          {u.features.map((f) => (
            <span key={f.id} className={`pill ${f.included ? "good" : ""}`} style={f.included ? undefined : { color: "var(--muted)", textDecoration: "line-through" }}>
              {f.included ? "✓ " : ""}
              {f.label}
            </span>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Practice, assignments, analytics, leagues, duels, missions, certificates and browser-proctored tests are in every plan. Contact PlayCode to change plans or seats.
        </p>
      </div>
      {!u.billedByPartner && (
        <>
          <form className="card stack" onSubmit={save}>
            <h2 style={{ margin: 0 }}>Billing details</h2>
            <div className="row wrap">
              <div style={{ flex: 2, minWidth: 240 }}>
                <label htmlFor="bp-name">Legal name</label>
                <input id="bp-name" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} required />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="bp-gstin">GSTIN (optional)</label>
                <input id="bp-gstin" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} placeholder="29ABCDE1234F1Z5" />
              </div>
            </div>
            <div>
              <label htmlFor="bp-address">Billing address</label>
              <textarea id="bp-address" rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} required />
            </div>
            <div className="row wrap">
              <div style={{ width: 140 }}>
                <label htmlFor="bp-state">State code</label>
                <input id="bp-state" value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })} maxLength={2} placeholder="29" disabled={Boolean(f.gstin)} />
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label htmlFor="bp-email">Accounts email</label>
                <input id="bp-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
              </div>
            </div>
            {saveError && <ErrorBox message={saveError} />}
            {msg && <span className="pill good" style={{ alignSelf: "flex-start" }}>{msg}</span>}
            <button className="btn primary" style={{ alignSelf: "flex-start" }}>
              Save details
            </button>
          </form>
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Invoices</h2>
            <InvoiceTable invoices={data.invoices} admin={false} onlinePayments={data.onlinePayments} onChange={reload} />
          </div>
        </>
      )}
    </div>
  );
}

export default function Billing() {
  const me = useMe();
  return me.user.roles.includes("super_admin") && !me.tenant ? <AdminBilling /> : <TenantBilling />;
}
