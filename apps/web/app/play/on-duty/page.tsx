"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  ON_DUTY_PARTS,
  type OnDutyPart,
  type OnDutyReason,
} from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

interface Request {
  id: string;
  ref: string;
  date: string;
  part: OnDutyPart;
  partLabel: string;
  purpose: string;
  detail: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  canCancel: boolean;
}
interface OnDuty {
  today: string;
  window: { from: string; to: string };
  upcoming: Request[];
  past: Request[];
  drives: {
    id: string;
    company: string;
    roleTitle: string;
    driveDate: string;
  }[];
  openings: { id: string; company: string; roleTitle: string }[];
}

const STATUS: Record<Request["status"], [string, string]> = {
  pending: ["Waiting for the placement cell", "warn"],
  approved: ["Approved", "good"],
  rejected: ["Not approved", "bad"],
};
const PARTS = Object.keys(ON_DUTY_PARTS) as OnDutyPart[];

function Ask({ data, onDone }: { data: OnDuty; onDone: (d: OnDuty) => void }) {
  const t = useT();
  const [reason, setReason] = useState<OnDutyReason>(
    data.drives.length ? "drive" : data.openings.length ? "opening" : "other",
  );
  const [driveId, setDriveId] = useState(data.drives[0]?.id ?? "");
  const [openingId, setOpeningId] = useState(data.openings[0]?.id ?? "");
  const [date, setDate] = useState(
    data.drives[0] && data.drives[0].driveDate >= data.window.from
      ? data.drives[0].driveDate
      : data.today,
  );
  const [part, setPart] = useState<OnDutyPart>("full");
  const [purpose, setPurpose] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const reasons: [OnDutyReason, string, boolean][] = [
    ["drive", "A campus drive", data.drives.length > 0],
    ["opening", "An off-campus drive", data.openings.length > 0],
    ["other", "Something else", true],
  ];
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      onDone(
        await api<OnDuty>("/student/on-duty", {
          body: {
            reason,
            date,
            part,
            driveId: reason === "drive" ? driveId : null,
            openingId: reason === "opening" ? openingId : null,
            purpose,
            detail,
          },
        }),
      );
      setPurpose("");
      setDetail("");
    } catch (err) {
      setMsg(errorMessage(err));
    }
    setBusy(false);
  }
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="h-ask">
      <h2 id="h-ask" style={{ margin: 0 }}>
        {t("Ask for on duty")}
      </h2>
      <fieldset
        className="stack"
        style={{ gap: 6, border: 0, padding: 0, margin: 0 }}
      >
        <legend className="small muted" style={{ padding: 0, marginBottom: 6 }}>
          {t("What for")}
        </legend>
        <div className="row wrap" style={{ gap: 12 }}>
          {reasons
            .filter(([, , ok]) => ok)
            .map(([k, label]) => (
              <label key={k} className="row small" style={{ gap: 6 }}>
                <input
                  type="radio"
                  name="reason"
                  style={{ width: "auto" }}
                  checked={reason === k}
                  onChange={() => setReason(k)}
                />
                {t(label)}
              </label>
            ))}
        </div>
      </fieldset>
      {reason === "drive" && (
        <div>
          <label htmlFor="od-drive">{t("Drive")}</label>
          <select
            id="od-drive"
            value={driveId}
            onChange={(e) => {
              setDriveId(e.target.value);
              const d = data.drives.find((x) => x.id === e.target.value);
              if (d && d.driveDate >= data.window.from) setDate(d.driveDate);
            }}
          >
            {data.drives.map((d) => (
              <option key={d.id} value={d.id}>
                {d.company}, {d.roleTitle} ({d.driveDate})
              </option>
            ))}
          </select>
        </div>
      )}
      {reason === "opening" && (
        <div>
          <label htmlFor="od-opening">{t("Opening you applied to")}</label>
          <select
            id="od-opening"
            value={openingId}
            onChange={(e) => setOpeningId(e.target.value)}
          >
            {data.openings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.company}, {o.roleTitle}
              </option>
            ))}
          </select>
        </div>
      )}
      {reason === "other" && (
        <div>
          <label htmlFor="od-purpose">{t("What is it?")}</label>
          <input
            id="od-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            maxLength={200}
            required
            placeholder={t(
              "e.g. Smart India Hackathon finale, or an interview at a company's office",
            )}
          />
        </div>
      )}
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        <div>
          <label htmlFor="od-date">{t("Date")}</label>
          <input
            id="od-date"
            type="date"
            value={date}
            min={data.window.from}
            max={data.window.to}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <fieldset
          className="row"
          style={{ gap: 10, border: 0, padding: 0, margin: 0 }}
        >
          <legend
            className="small muted"
            style={{ padding: 0, marginBottom: 6 }}
          >
            {t("Away for")}
          </legend>
          {PARTS.map((p) => (
            <label key={p} className="row small" style={{ gap: 6 }}>
              <input
                type="radio"
                name="part"
                style={{ width: "auto" }}
                checked={part === p}
                onChange={() => setPart(p)}
              />
              {t(ON_DUTY_PARTS[p])}
            </label>
          ))}
        </fieldset>
      </div>
      <div>
        <label htmlFor="od-detail">
          {t(
            "Where, or anything else the placement cell should know (optional)",
          )}
        </label>
        <input
          id="od-detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={300}
        />
      </div>
      {msg && <ErrorBox message={msg} />}
      <div>
        <button className="btn primary small" disabled={busy}>
          {busy ? t("Sending...") : t("Ask for on duty")}
        </button>
      </div>
    </form>
  );
}

function Item({ r, onChange }: { r: Request; onChange: (d: OnDuty) => void }) {
  const t = useT();
  const locale = useLocale();
  const [msg, setMsg] = useState<string | null>(null);
  const day = new Date(`${r.date}T00:00:00Z`).toLocaleDateString(
    intlLocale(locale),
    { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" },
  );
  async function letter() {
    setMsg(null);
    try {
      const a = document.createElement("a");
      a.href = await fetchObjectUrl(`/student/on-duty/${r.id}/letter`);
      a.download = `on-duty-${r.date}-${r.ref}.pdf`;
      a.click();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  async function cancel() {
    if (!window.confirm(t("Call off this on-duty request?"))) return;
    setMsg(null);
    try {
      onChange(
        await api<OnDuty>(`/student/on-duty/${r.id}/cancel`, { body: {} }),
      );
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const [label, tone] = STATUS[r.status];
  return (
    <div
      className="stack"
      style={{ gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }}
    >
      <div className="spread wrap" style={{ gap: 8 }}>
        <div>
          <b>{day}</b> <span className="small muted">{t(r.partLabel)}</span>
          <div className="small">{r.purpose}</div>
        </div>
        <span className={`pill ${tone}`}>{t(label)}</span>
      </div>
      {r.note && (
        <div
          className="small"
          style={
            r.status === "rejected" ? { color: "var(--bad-ink)" } : undefined
          }
        >
          {r.status === "rejected" ? t("From the placement cell:") : ""}{" "}
          {t(r.note)}
        </div>
      )}
      <div className="row wrap" style={{ gap: 6 }}>
        {r.status === "approved" && (
          <button className="btn small" onClick={letter}>
            {t("Download the letter")}
          </button>
        )}
        {r.canCancel && (
          <button className="btn ghost small" onClick={cancel}>
            {t("Call it off")}
          </button>
        )}
        <span className="small muted">{r.ref}</span>
      </div>
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

export default function OnDutyPage() {
  const t = useT();
  const { data, error, loading, reload, setData } =
    useApi<OnDuty>("/student/on-duty");
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return (
    <div className="stack">
      <Link href="/play/placements" className="small">
        ← {t("Placements")}
      </Link>
      <div>
        <h1 style={{ margin: 0 }}>{t("On duty")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t(
            "For a day you miss class for a drive, an interview or a placement event. Once the placement cell approves, your class teacher sees it; download the letter if they ask.",
          )}
        </p>
      </div>
      {data.upcoming.length > 0 && (
        <section className="card stack" aria-labelledby="h-coming">
          <h2 id="h-coming" style={{ margin: 0 }}>
            {t("Coming up")}
          </h2>
          {data.upcoming.map((r) => (
            <Item key={r.id} r={r} onChange={setData} />
          ))}
        </section>
      )}
      <Ask data={data} onDone={setData} />
      {data.past.length > 0 && (
        <section className="card stack" aria-labelledby="h-past">
          <h2 id="h-past" style={{ margin: 0 }}>
            {t("Earlier")}
          </h2>
          {data.past.map((r) => (
            <Item key={r.id} r={r} onChange={setData} />
          ))}
        </section>
      )}
    </div>
  );
}
