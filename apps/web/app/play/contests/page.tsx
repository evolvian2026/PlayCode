"use client";

import Link from "next/link";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { STATE_LABEL } from "@/lib/contests";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

interface ContestRow {
  id: string;
  title: string;
  byPlayCode: boolean;
  state: "upcoming" | "live" | "frozen" | "ended";
  startsAt: string;
  endsAt: string;
  problems: number;
  solved: number;
}

export default function ContestsPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload } = useApi<{ contests: ContestRow[] }>("/student/contests");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const fmt = (iso: string) => new Date(iso).toLocaleString(intlLocale(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Coding contests")}</h1>
      {data.contests.length === 0 && <div className="card muted">{t("No contests right now. Your college or PlayCode will announce the next one.")}</div>}
      {data.contests.map((c) => (
        <Link key={c.id} href={`/play/contests/${c.id}`} className="card spread" style={{ color: "inherit" }}>
          <div>
            <div style={{ fontWeight: 700 }}>{c.title}</div>
            <div className="small muted">
              {c.byPlayCode ? `${t("Inter-college")} · ` : ""}
              {fmt(c.startsAt)} - {fmt(c.endsAt)} · {t("{n} problems", { n: c.problems })}
            </div>
            {c.state !== "upcoming" && <div className="small">{t("Solved {n} of {total}", { n: c.solved, total: c.problems })}</div>}
          </div>
          <span className={`pill ${c.state === "live" || c.state === "frozen" ? "good" : c.state === "upcoming" ? "accent" : ""}`}>{t(STATE_LABEL[c.state])}</span>
        </Link>
      ))}
    </div>
  );
}
