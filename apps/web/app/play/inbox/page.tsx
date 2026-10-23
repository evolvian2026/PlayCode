"use client";

import { useEffect } from "react";
import { ErrorBox, Loading, timeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/api";

interface Inbox {
  unread: number;
  items: { id: string; template: string; title: string; body: string; link: string | null; createdAt: string; read: boolean }[];
}

const LABEL: Record<string, string> = {
  announcement: "From your institution",
  streak_at_risk: "Streak",
  review_due: "Review",
  talent_invite: "Companies",
  assignment_due: "Assignment",
  test_open: "Test",
  duel_invite: "Duel",
  placement: "Placements",
};

export default function InboxPage() {
  const { data, error, loading, reload } = useApi<Inbox>("/student/notifications");
  useEffect(() => {
    if (data?.unread) void api("/student/notifications/read", { body: {} });
  }, [data?.unread]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  return (
    <div className="stack">
      <h1>Messages</h1>
      {data.items.length === 0 && <div className="card">No messages yet.</div>}
      {data.items.map((n) => (
        <a key={n.id} href={n.link ? new URL(n.link, window.location.origin).pathname : "#"} className="card tight stack" style={{ gap: 4, color: "inherit", borderColor: n.read ? undefined : "var(--accent)" }}>
          <div className="spread small">
            <span className="pill accent">{LABEL[n.template] ?? n.template}</span>
            <span className="muted">{timeAgo(n.createdAt)}</span>
          </div>
          <b>{n.title}</b>
          <span className="small">{n.body}</span>
        </a>
      ))}
    </div>
  );
}
