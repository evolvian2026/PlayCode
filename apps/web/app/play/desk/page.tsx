"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

interface DeskRow {
  id: string;
  company: string;
  driveDate: string;
  location: string;
  open: boolean;
}
interface Desk {
  drive: { id: string; company: string; roleTitle: string; driveDate: string; location: string };
  expected: number;
  reported: number;
  students: { userId: string; name: string; rollNo: string | null; round: string; slot: { round: string; startsAt: string } | null; reportedAt: string | null }[];
}

function DeskView({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload, setData } = useApi<Desk>(`/student/desks/${id}`);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Other coordinators check students in too: keep the list fresh.
  useEffect(() => {
    const timer = setInterval(() => void reload(), 20_000);
    return () => clearInterval(timer);
  }, [reload]);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const time = (d: string) => new Date(d).toLocaleTimeString(locale === "hi" ? "hi-IN" : "en-IN", { hour: "numeric", minute: "2-digit" });
  async function mark(userId: string, reported: boolean) {
    setBusy(userId);
    setMsg(null);
    try {
      setData(await api<Desk>(`/student/desks/${id}/${userId}`, { method: "PUT", body: { reported } }));
      if (reported) setQ("");
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const needle = q.trim().toLowerCase();
  const list = data.students.filter((s) => !needle || `${s.name} ${s.rollNo ?? ""}`.toLowerCase().includes(needle));
  return (
    <div className="stack">
      <div>
        <Link href="/play/desk" className="small muted">
          ← {t("Reporting desk")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{data.drive.company}</h1>
        <div className="small muted">
          {data.drive.roleTitle}
          {data.drive.location && ` · ${data.drive.location}`}
        </div>
      </div>
      <div className="card tight" role="status">
        <b style={{ fontSize: 22 }}>
          {data.reported} / {data.expected}
        </b>{" "}
        <span className="small muted">{t("students have reported")}</span>
      </div>
      <div>
        <label htmlFor="d-find">{t("Find by roll number or name")}</label>
        <input id="d-find" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" autoComplete="off" />
      </div>
      {msg && <ErrorBox message={msg} />}
      {list.length === 0 ? (
        <div className="card muted">{t("Nobody by that name or roll number is expected today.")}</div>
      ) : (
        list.map((s) => (
          <div key={s.userId} className="card tight spread" style={{ gap: 8, borderColor: s.reportedAt ? "var(--good)" : undefined }}>
            <div>
              <b>{s.rollNo ?? s.name}</b> <span>{s.rollNo ? s.name : ""}</span>
              <div className="small muted">{s.slot ? t("{round} at {time}", { round: s.slot.round, time: time(s.slot.startsAt) }) : s.round}</div>
            </div>
            {s.reportedAt ? (
              <div className="row" style={{ gap: 6 }}>
                <span className="small" style={{ color: "var(--good-ink)", fontWeight: 600 }}>
                  ✓ {time(s.reportedAt)}
                </span>
                <button className="btn ghost small" disabled={busy === s.userId} onClick={() => mark(s.userId, false)} aria-label={t("Undo check-in for {name}", { name: s.name })}>
                  {t("Undo")}
                </button>
              </div>
            ) : (
              <button className="btn primary small" disabled={busy === s.userId} onClick={() => mark(s.userId, true)} aria-label={t("Check in {name}", { name: s.name })}>
                {t("Check in")}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function Desks() {
  const t = useT();
  const locale = useLocale();
  const id = useSearchParams().get("drive");
  const { data, error, loading, reload } = useApi<{ desks: DeskRow[] }>(id ? null : "/student/desks");
  if (id) return <DeskView key={id} id={id} />;
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="stack">
      <div>
        <Link href="/play/placements" className="small muted">
          ← {t("Placements")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{t("Reporting desk")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Drives your placement cell asked you to help with. Check students in as they arrive; the desk opens the day before the drive.")}
        </p>
      </div>
      {!data?.desks.length ? (
        <div className="card muted">{t("You aren't coordinating any drive.")}</div>
      ) : (
        data.desks.map((d) =>
          d.open ? (
            <Link key={d.id} href={`/play/desk?drive=${d.id}`} className="card spread" style={{ color: "inherit" }}>
              <div>
                <b>{d.company}</b>
                <div className="small muted">
                  {day(d.driveDate)}
                  {d.location && ` · ${d.location}`}
                </div>
              </div>
              <span className="pill good">{t("Open")}</span>
            </Link>
          ) : (
            <div key={d.id} className="card spread">
              <div>
                <b>{d.company}</b>
                <div className="small muted">{day(d.driveDate)}</div>
              </div>
              <span className="pill">{t("Opens the day before")}</span>
            </div>
          ),
        )
      )}
    </div>
  );
}

export default function DeskPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Desks />
    </Suspense>
  );
}
