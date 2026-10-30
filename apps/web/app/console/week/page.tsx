"use client";

import Link from "next/link";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useState } from "react";

interface Week {
  institution: string;
  weekOf: string;
  drives: { id: string; company: string; roleTitle: string; driveDate: string; registered: number }[];
  offers: { total: number; byCompany: { company: string; n: number }[] };
  queues: { key: string; label: string; count: number; link: string }[];
  waiting: number;
  peer: { sessions: number; students: number; noShows: number };
  digest: { enabled: boolean; emailConfigured: boolean };
}

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export default function WeekPage() {
  const { data, error, loading, reload, setData } = useApi<Week>("/console/week");
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  async function toggle() {
    setMsg(null);
    try {
      const digest = await api<Week["digest"]>("/console/week/digest", { method: "PUT", body: { enabled: !data!.digest.enabled } });
      setData({ ...data!, digest });
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const open = data.queues.filter((q) => q.count > 0);
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
      <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>This week</h1>
          <p className="muted" style={{ margin: 0 }}>
            {data.waiting ? `${data.waiting} things waiting on the placement cell.` : "Nothing is waiting on the placement cell."} Drives coming up and offers made, in one place.
          </p>
        </div>
        <div className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={data.digest.enabled} onChange={toggle} disabled={!data.digest.emailConfigured} />
            Email me this every Monday morning
          </label>
          {!data.digest.emailConfigured && <span className="small muted">Email isn&apos;t set up on this server.</span>}
          {msg && <ErrorBox message={msg} />}
        </div>
      </div>

      <section className="card stack" aria-labelledby="h-queues">
        <h2 id="h-queues" style={{ margin: 0 }}>
          Waiting on you
        </h2>
        {open.length === 0 ? (
          <div className="small muted">All clear.</div>
        ) : (
          open.map((q) => (
            <Link key={q.key} href={q.link} className="spread" style={{ color: "inherit", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <span>{q.label}</span>
              <span className={`pill ${q.count >= 5 ? "bad" : "warn"}`}>{q.count}</span>
            </Link>
          ))
        )}
        {data.queues.length > open.length && <div className="small muted">Nothing waiting: {data.queues.filter((q) => !q.count).map((q) => q.label.toLowerCase()).join("; ")}.</div>}
      </section>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <section className="card stack" aria-labelledby="h-drives">
          <h2 id="h-drives" style={{ margin: 0 }}>
            Drives in the next seven days
          </h2>
          {data.drives.length === 0 ? (
            <div className="small muted">None.</div>
          ) : (
            data.drives.map((d) => (
              <Link key={d.id} href={`/console/placements/${d.id}`} className="spread" style={{ color: "inherit" }}>
                <span>
                  <b>{d.company}</b> <span className="small muted">{d.roleTitle}</span>
                </span>
                <span className="small">
                  {day(d.driveDate)} · {d.registered} registered
                </span>
              </Link>
            ))
          )}
        </section>
        <section className="card stack" aria-labelledby="h-offers">
          <h2 id="h-offers" style={{ margin: 0 }}>
            Last seven days
          </h2>
          <div>
            <b style={{ fontSize: 24 }}>{data.offers.total}</b> <span className="small muted">offers made</span>
            {data.offers.byCompany.length > 0 && <div className="small">{data.offers.byCompany.map((o) => `${o.company} ${o.n}`).join(" · ")}</div>}
          </div>
          <div>
            <b style={{ fontSize: 24 }}>{data.peer.sessions}</b> <span className="small muted">practice interviews between students ({data.peer.students} students)</span>
            {data.peer.noShows > 0 && <div className="small muted">{data.peer.noShows} sessions where a partner didn&apos;t come</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
