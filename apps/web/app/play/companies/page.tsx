"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { COMPANY_TYPE_LABELS, formatLpa, type CompanyType } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { startAndOpen } from "@/lib/start";

interface Company {
  company: string;
  companyType: CompanyType;
  drives: number;
  years: number[];
  lastDriveDate: string;
  highestCtc: number;
  offers: number;
  experiences: number;
  openDrive: { id: string; roleTitle: string; registerBy: string } | null;
}

interface Page {
  company: string;
  companyType: CompanyType;
  readinessProfile: "service" | "product";
  drives: { id: string; roleTitle: string; driveDate: string; ctcRupees: number; location: string; rounds: string[]; open: boolean; registered: number; offers: number; selectionPct: number | null; mine: string | null }[];
  readiness: { mine: number; selectedMedian: number | null };
  experiences: { count: number; averageDifficulty: number; selected: number } | null;
  pack: { id: string; title: string } | null;
}

const MINE: Record<string, string> = { registered: "You registered", shortlisted: "You're in the selection", rejected: "You took part", offered: "You got an offer" };

function CompanyView({ name }: { name: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Page>(`/student/companies/${encodeURIComponent(name)}`);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { month: "short", year: "numeric" });
  const open = data.drives.find((d) => d.open);
  const gap = data.readiness.selectedMedian === null ? null : data.readiness.selectedMedian - data.readiness.mine;
  return (
    <div className="stack">
      <div>
        <Link href="/play/companies" className="small muted">
          ← {t("Companies")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{data.company}</h1>
        <div className="small muted">{t(COMPANY_TYPE_LABELS[data.companyType])}</div>
      </div>
      {open && (
        <Link href="/play/placements" className="card spread" style={{ color: "inherit", borderColor: "var(--accent)" }}>
          <div>
            <b>{t("Drive open now: {role}", { role: open.roleTitle })}</b>
            <div className="small muted">{t("Register on the Placements page")}</div>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
      )}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t("Are you ready?")}</h2>
        <div className="row wrap" style={{ gap: 24 }}>
          <div>
            <div className="small muted">{t(data.readinessProfile === "product" ? "Your product-company readiness" : "Your service-company readiness")}</div>
            <span className="kpi">{data.readiness.mine}</span>
          </div>
          {data.readiness.selectedMedian !== null && (
            <div>
              <div className="small muted">{t("Typical readiness of those selected, when they registered")}</div>
              <span className="kpi">{data.readiness.selectedMedian}</span>
            </div>
          )}
        </div>
        {startError && <ErrorBox message={startError} />}
        {gap !== null && <div className="small">{gap > 0 ? t("You're {n} points short of where selected students were. Keep practising.", { n: gap }) : t("You're at or above where selected students were.")}</div>}
        <div className="row wrap">
          {data.pack && (
            <button
              className="btn primary small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setStartError(await startAndOpen({ kind: "pack", packId: data.pack!.id }, router.push));
                setBusy(false);
              }}
            >
              {t("Practise: {mission}", { mission: data.pack.title })}
            </button>
          )}
          {data.experiences && (
            <Link className="btn small" href={`/play/experiences?company=${encodeURIComponent(data.company)}`}>
              {t(data.experiences.count === 1 ? "Read 1 interview experience" : "Read {n} interview experiences", { n: data.experiences.count })}
            </Link>
          )}
        </div>
      </div>
      <h2 style={{ margin: "8px 0 0" }}>{t("Drives at your college")}</h2>
      {data.drives.map((d) => (
        <div key={d.id} className="card stack" style={{ gap: 6 }}>
          <div className="spread wrap" style={{ gap: 8 }}>
            <div>
              <b>{d.roleTitle}</b>
              <div className="small muted">
                {fmt(d.driveDate)} · {formatLpa(d.ctcRupees)}
                {d.location ? ` · ${d.location}` : ""}
              </div>
            </div>
            {d.mine ? <span className={`pill ${d.mine === "offered" ? "good" : ""}`}>{t(MINE[d.mine] ?? d.mine)}</span> : d.open ? <span className="pill accent">{t("Open")}</span> : null}
          </div>
          <div className="small">
            {t("Rounds")}: {d.rounds.join(" → ")}
          </div>
          <div className="small muted">
            {t("{registered} registered · {offers} offers", { registered: d.registered, offers: d.offers })}
            {d.selectionPct !== null ? ` · ${t("{n}% selected", { n: d.selectionPct })}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function CompanyList() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload } = useApi<{ companies: Company[] }>("/student/companies");
  const [q, setQ] = useState("");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const shown = data.companies.filter((c) => c.company.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="stack">
      <div>
        <Link href="/play/placements" className="small muted">
          ← {t("Placements")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{t("Companies")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Every company that has held a drive at your college, from the placement cell's records.")}
        </p>
      </div>
      <input aria-label={t("Search companies")} placeholder={t("Search companies")} value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 ? (
        <div className="card muted">{t("No companies match.")}</div>
      ) : (
        shown.map((c) => (
          <Link key={c.company} href={`/play/companies?name=${encodeURIComponent(c.company)}`} className="card spread" style={{ color: "inherit", gap: 8 }}>
            <div>
              <b>{c.company}</b>
              <div className="small muted">
                {t(COMPANY_TYPE_LABELS[c.companyType])} · {t("up to {ctc}", { ctc: formatLpa(c.highestCtc) })} · {c.years.join(", ")}
              </div>
              <div className="small muted">
                {t(c.offers === 1 ? "1 offer" : "{n} offers", { n: c.offers })}
                {c.experiences ? ` · ${t(c.experiences === 1 ? "1 experience" : "{n} experiences", { n: c.experiences })}` : ""}
                {c.openDrive ? ` · ${t("register by {date}", { date: new Date(c.openDrive.registerBy).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" }) })}` : ""}
              </div>
            </div>
            {c.openDrive ? <span className="pill accent">{t("Open")}</span> : <span aria-hidden="true">→</span>}
          </Link>
        ))
      )}
    </div>
  );
}

function Companies() {
  const name = useSearchParams().get("name");
  return name ? <CompanyView key={name} name={name} /> : <CompanyList />;
}

export default function CompaniesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Companies />
    </Suspense>
  );
}
