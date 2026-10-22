"use client";

import { useEffect, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";

interface SubscriptionInfo {
  subscription: { enabled: boolean; unitId: string | null; weekday: number; hour: number; lastSentAt: string | null; lastError: string | null } | null;
  units: { id: string; name: string; kind: string }[];
  emailConfigured: boolean;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function Reports() {
  const { data, error, loading, reload, setData } = useApi<SubscriptionInfo>("/console/reports/subscription");
  const [unitId, setUnitId] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [subUnit, setSubUnit] = useState("");
  const [weekday, setWeekday] = useState(1);
  const [hour, setHour] = useState(8);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const s = data?.subscription;
    if (!s) return;
    setEnabled(s.enabled);
    setSubUnit(s.unitId ?? "");
    setWeekday(s.weekday);
    setHour(s.hour);
  }, [data]);

  async function download() {
    setDownloading(true);
    setActionError(null);
    try {
      const url = await fetchObjectUrl(`/console/reports/weekly.pdf${unitId ? `?unitId=${unitId}` : ""}`);
      const a = document.createElement("a");
      a.href = url;
      a.download = "weekly-report.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  async function save() {
    setActionError(null);
    setMsg(null);
    try {
      const r = await api<{ subscription: SubscriptionInfo["subscription"] }>("/console/reports/subscription", { method: "PUT", body: { enabled, unitId: subUnit || null, weekday, hour } });
      setData({ ...data!, subscription: r.subscription });
      setMsg(enabled ? `Saved. The report arrives every ${DAYS[weekday]} after ${String(hour).padStart(2, "0")}:00.` : "Saved. Weekly emails are off.");
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const unitSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All my batches and sections</option>
      {data.units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
      <div>
        <h1 style={{ margin: 0 }}>Reports</h1>
        <p className="muted" style={{ margin: 0 }}>
          A one-page weekly PDF: activity, placement readiness, weakest skills, assignments, learning paths and the students who need help.
        </p>
      </div>
      {actionError && <ErrorBox message={actionError} />}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Download this week&apos;s report</h2>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="r-unit">For</label>
            {unitSelect(unitId, setUnitId, "r-unit")}
          </div>
          <button className="btn primary" disabled={downloading} onClick={download}>
            {downloading ? "Preparing..." : "Download PDF"}
          </button>
        </div>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Email it to me every week</h2>
        {!data.emailConfigured && <p className="small muted" style={{ margin: 0 }}>Email is not set up on this PlayCode server yet; your choice is saved and takes effect once it is.</p>}
        <label className="row" style={{ gap: 6, fontWeight: 500 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Send me the weekly report
        </label>
        <div className="row wrap">
          <div style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="s-unit">For</label>
            {unitSelect(subUnit, setSubUnit, "s-unit")}
          </div>
          <div>
            <label htmlFor="s-day">Day</label>
            <select id="s-day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="s-hour">After</label>
            <select id="s-hour" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
        </div>
        {data.subscription?.lastSentAt && <div className="small muted">Last sent {new Date(data.subscription.lastSentAt).toLocaleString()}</div>}
        {data.subscription?.lastError && <div className="small" style={{ color: "var(--bad)" }}>Last attempt failed: {data.subscription.lastError}</div>}
        {msg && <span className="pill good" style={{ alignSelf: "flex-start" }}>{msg}</span>}
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
