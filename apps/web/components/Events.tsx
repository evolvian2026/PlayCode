"use client";

import { useDates } from "./ui";
import { useT } from "@/lib/i18n";

export interface EventItem {
  id: string;
  title: string;
  description: string;
  scope: "sections" | "colleges";
  startsAt: string;
  endsAt: string;
  state: "upcoming" | "live" | "ended";
  myTeam: { name: string; rank: number; score: number } | null;
  leaderboard: { teamId: string; name: string; members: number; activeMembers: number; totalXp: number; score: number; rank: number }[];
}

/** An event and its team leaderboard (XP per member). */
export function EventCard({ ev, highlight }: { ev: EventItem; highlight?: string }) {
  const t = useT();
  const dates = useDates();
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="spread">
        <div>
          <h2 style={{ margin: 0 }}>{ev.title}</h2>
          <div className="muted small">
            {t(ev.scope === "colleges" ? "Inter-college" : "Section vs section")} ·{" "}
            {ev.state === "live" ? t("ends {when}", { when: dates.when(ev.endsAt) }) : ev.state === "upcoming" ? t("starts {when}", { when: dates.when(ev.startsAt) }) : t("ended")}
          </div>
        </div>
        <span className={`pill ${ev.state === "live" ? "good" : ""}`}>{t(ev.state === "live" ? "Live" : ev.state === "upcoming" ? "Soon" : "Final")}</span>
      </div>
      {ev.description && <p className="small" style={{ margin: 0 }}>{ev.description}</p>}
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>{t(ev.scope === "colleges" ? "College" : "Section")}</th>
            <th>{t("XP per member")}</th>
            <th>{t("Active")}</th>
          </tr>
        </thead>
        <tbody>
          {ev.leaderboard.map((r) => (
            <tr key={r.teamId} style={{ background: r.name === highlight ? "var(--accent-soft)" : undefined }}>
              <td>{r.rank}</td>
              <td style={{ fontWeight: r.name === highlight ? 700 : 500 }}>{r.name}</td>
              <td className="stat-xp" style={{ fontWeight: 700 }}>
                {r.score}
              </td>
              <td className="small muted">
                {r.activeMembers}/{r.members}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
