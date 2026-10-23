"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

type CompanyType = "service" | "product";

interface Talent {
  allowed: boolean;
  discoverable: boolean;
  lookingFor: { locations?: string[]; companyTypes?: CompanyType[] };
  invites: {
    id: string;
    company: string;
    roleTitle: string;
    message: string;
    status: "pending" | "accepted" | "declined" | "expired";
    createdAt: string;
    expiresAt: string;
    applyUrl: string | null;
  }[];
}

const STATUS: Record<Talent["invites"][number]["status"], string> = { pending: "Waiting for you", accepted: "Accepted", declined: "Declined", expired: "Lapsed" };

export default function TalentPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload, setData } = useApi<Talent>("/student/talent");
  const [locations, setLocations] = useState("");
  const [types, setTypes] = useState<CompanyType[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setLocations((data.lookingFor.locations ?? []).join(", "));
    setTypes(data.lookingFor.companyTypes ?? []);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" });

  async function save(discoverable: boolean) {
    if (!discoverable && !window.confirm(t("Leave the talent pool? Companies will no longer find you; invitations you already have stay here."))) return;
    setBusy(true);
    setActionError(null);
    setSaved(false);
    try {
      const lookingFor = { locations: locations.split(",").map((l) => l.trim()).filter(Boolean).slice(0, 5), companyTypes: types };
      setData(await api<Talent>("/student/talent", { method: "PUT", body: { discoverable, lookingFor } }));
      setSaved(true);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function respond(id: string, accept: boolean) {
    if (accept && !window.confirm(t("Accept? The company will see your email and phone number."))) return;
    setBusy(true);
    setActionError(null);
    try {
      setData(await api<Talent>(`/student/talent/invites/${id}/${accept ? "accept" : "decline"}`, { body: {} }));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Get found by companies")}</h1>

      {data.invites.length > 0 && (
        <section className="stack" aria-label={t("Invitations")}>
          <h2 style={{ margin: 0 }}>{t("Invitations")}</h2>
          {data.invites.map((i) => (
            <div key={i.id} className="card stack" style={{ gap: 8 }}>
              <div className="spread" style={{ alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{i.company}</div>
                  <div className="small">{i.roleTitle}</div>
                  <div className="small muted">
                    {fmt(i.createdAt)}
                    {i.status === "pending" ? ` · ${t("answer by {date}", { date: fmt(i.expiresAt) })}` : ""}
                  </div>
                </div>
                <span className={`pill ${i.status === "accepted" ? "good" : i.status === "pending" ? "accent" : ""}`}>{t(STATUS[i.status])}</span>
              </div>
              <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {i.message}
              </p>
              {i.status === "pending" && (
                <div className="row wrap">
                  <button className="btn primary small" disabled={busy} onClick={() => respond(i.id, true)}>
                    {t("Accept and share my contact")}
                  </button>
                  <button className="btn ghost small" disabled={busy} onClick={() => respond(i.id, false)}>
                    {t("Decline")}
                  </button>
                </div>
              )}
              {i.status === "accepted" && (
                <div className="small">
                  {i.applyUrl ? (
                    <a className="btn primary small" href={i.applyUrl}>
                      {t("Apply to their drive")}
                    </a>
                  ) : (
                    t("They have your email and phone number and will contact you.")
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>{t("Talent pool")}</h2>
        {!data.allowed ? (
          <p className="small muted" style={{ margin: 0 }}>
            {t("Your institution hasn't opened the talent pool yet. Ask your placement cell.")}
          </p>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }}>
              {t("Companies hiring on PlayCode can find you by your readiness, mastered skills and graduation year, and invite you to apply. They see your public profile (and your marks unless you hide them on your resume page), never your email or phone until you accept an invitation.")}
            </p>
            <div>
              <label htmlFor="tal-loc">{t("Where would you work? (optional, up to 5 cities)")}</label>
              <input id="tal-loc" value={locations} onChange={(e) => setLocations(e.target.value)} placeholder={t("Bengaluru, Pune")} />
            </div>
            <fieldset className="row wrap" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
                {t("Kinds of company (none ticked: any)")}
              </legend>
              {(["service", "product"] as const).map((k) => (
                <label key={k} className="row small" style={{ gap: 6 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={types.includes(k)} onChange={(e) => setTypes(e.target.checked ? [...types, k] : types.filter((x) => x !== k))} />
                  {t(k === "service" ? "Service companies" : "Product companies")}
                </label>
              ))}
            </fieldset>
            {actionError && <ErrorBox message={actionError} />}
            <div className="row wrap">
              {data.discoverable ? (
                <>
                  <span className="pill good">{t("You are in the talent pool")}</span>
                  <button className="btn small" disabled={busy} onClick={() => save(true)}>
                    {t("Save preferences")}
                  </button>
                  <button className="btn ghost small" disabled={busy} onClick={() => save(false)}>
                    {t("Leave the pool")}
                  </button>
                </>
              ) : (
                <button className="btn primary" disabled={busy} onClick={() => save(true)}>
                  {t("Join the talent pool")}
                </button>
              )}
              {saved && <span className="small muted" role="status">{t("Saved")}</span>}
            </div>
            <div className="small muted">
              {t("Companies see what PlayCode measured, so practice raises your rank.")} <Link href="/play/resume">{t("Check what your profile shows")}</Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
