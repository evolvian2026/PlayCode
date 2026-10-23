"use client";

import { DIVISION_LABELS, type Division } from "@playcode/core";
import { Icon } from "@/components/Icon";
import { EventCard, type EventItem } from "@/components/Events";
import { ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

interface League {
  weekKey: string;
  division: Division;
  joined: boolean;
  members: { userId: string; name: string; weeklyXp: number; rank: number; isMe: boolean; zone: "promoted" | "demoted" | "stayed" }[];
}

export default function LeaguePage() {
  const { data, error, loading, reload } = useApi<League>("/student/league");
  const events = useApi<{ events: EventItem[] }>("/student/competitions");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>{DIVISION_LABELS[data.division]} league</h1>
          <p className="muted">Week {data.weekKey.split("-W")[1]} · resets Monday. Top players move up, the bottom few move down.</p>
        </div>
        <Icon name="trophy" size={36} className="stat-xp" />
      </div>
      {!data.joined ? (
        <div className="card">Answer a question this week to join a league group.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <tbody>
              {data.members.map((m, i) => {
                const prev = data.members[i - 1];
                const showPromoLine = prev && prev.zone === "promoted" && m.zone !== "promoted";
                const showDemoLine = m.zone === "demoted" && prev && prev.zone !== "demoted";
                return (
                  <tr key={m.userId} style={{ background: m.isMe ? "var(--accent-soft)" : undefined }}>
                    <td style={{ width: 48, fontWeight: 700, borderTop: showPromoLine ? "2px solid var(--good)" : showDemoLine ? "2px solid var(--bad)" : undefined }}>{m.rank}</td>
                    <td style={{ fontWeight: m.isMe ? 700 : 500, borderTop: showPromoLine ? "2px solid var(--good)" : showDemoLine ? "2px solid var(--bad)" : undefined }}>
                      {m.name} {m.isMe && <span className="pill accent">you</span>}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, borderTop: showPromoLine ? "2px solid var(--good)" : showDemoLine ? "2px solid var(--bad)" : undefined }} className="stat-xp">
                      {m.weeklyXp} XP
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {events.data?.events.map((ev) => <EventCard key={ev.id} ev={ev} highlight={ev.myTeam?.name} />)}
      <p className="muted small">
        <span style={{ color: "var(--good-ink)" }}>Green line</span>: promotion zone. <span style={{ color: "var(--bad-ink)" }}>Red line</span>: demotion zone.
      </p>
    </div>
  );
}
