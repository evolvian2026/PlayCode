"use client";

import { ErrorBox, Loading, Stat, timeAgo } from "@/components/ui";
import { useApi } from "@/lib/api";

interface Status {
  ready: { ready: boolean; database: boolean; migrations: { applied: number; expected: number | null } | null; error?: string };
  jobs: {
    job: string;
    label: string;
    everyHours: number;
    lastRun: { status: "running" | "ok" | "failed"; startedAt: string; finishedAt: string | null; summary: Record<string, unknown> | null; error: string | null } | null;
    lastSuccessAt: string | null;
    failuresRecently: number;
    healthy: boolean;
  }[];
  backlog: { notificationsPending: number; webhooksPending: number; webhooksFailed: number; lmsScoresPending: number };
  databaseBytes: number;
  version: string | null;
  checkedAt: string;
}

const every = (h: number) => (h < 1 ? `every ${Math.round(h * 60)} min` : h === 1 ? "hourly" : h === 24 ? "daily" : h === 168 ? "weekly" : `every ${h} h`);

export default function SystemStatus() {
  const { data, error, loading, reload } = useApi<Status>("/admin/system");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const unhealthy = data.jobs.filter((j) => !j.healthy).length;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <h1 style={{ margin: 0 }}>System status</h1>
          <p className="muted" style={{ margin: 0 }}>
            Checked {new Date(data.checkedAt).toLocaleString("en-IN")}
            {data.version && ` · version ${data.version}`}. Monitoring can scrape the same numbers from /metrics.
          </p>
        </div>
        <button className="btn small" onClick={reload}>
          Refresh
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <Stat label="Database" value={data.ready.database ? "Reachable" : "Down"} sub={data.ready.migrations ? `${data.ready.migrations.applied} migrations applied` : data.ready.error} />
        <Stat label="Scheduled jobs" value={unhealthy ? `${unhealthy} need attention` : "All running"} />
        <Stat label="Messages waiting" value={data.backlog.notificationsPending} sub={`${data.backlog.webhooksPending} webhooks, ${data.backlog.lmsScoresPending} LMS grades`} />
        <Stat label="Failed webhooks" value={data.backlog.webhooksFailed} sub="gave up after all retries" />
        <Stat label="Database size" value={`${(data.databaseBytes / 1024 / 1024).toFixed(0)} MB`} />
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Schedule</th>
                <th>Last run</th>
                <th>Last success</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.job}>
                  <td>
                    <b>{j.label}</b>
                    <div className="small muted">{j.job}</div>
                  </td>
                  <td className="small">{every(j.everyHours)}</td>
                  <td className="small">
                    {j.lastRun ? (
                      <>
                        {timeAgo(j.lastRun.startedAt)} · {j.lastRun.status}
                        {j.lastRun.error && <div style={{ color: "var(--bad-ink)" }}>{j.lastRun.error}</div>}
                      </>
                    ) : (
                      "never"
                    )}
                  </td>
                  <td className="small">{j.lastSuccessAt ? timeAgo(j.lastSuccessAt) : "never"}</td>
                  <td>
                    <span className={`pill ${j.healthy ? "good" : "bad"}`}>{j.healthy ? "Healthy" : j.lastRun ? (j.lastRun.status === "failed" ? "Failing" : "Overdue") : "Not running"}</span>
                    {j.failuresRecently > 0 && <div className="small muted">{j.failuresRecently} failures in the last 20 runs</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        A job is overdue when it hasn&apos;t succeeded for twice its interval. Schedule them with cron or your platform&apos;s scheduler; see the README.
      </p>
    </div>
  );
}
