"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { DIVISION_LABELS } from "@playcode/core";
import { AuthGate } from "@/components/Auth";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { PlayerProvider, usePlayer } from "@/lib/player-state";
import { useLiveEvents } from "@/lib/realtime";

function InboxBell() {
  const path = usePathname();
  const [unread, setUnread] = useState(0);
  const load = () => void api<{ unread: number }>("/student/notifications").then((r) => setUnread(r.unread)).catch(() => {});
  useEffect(load, [path]);
  useLiveEvents((e) => {
    if (e.type === "notification") load();
  });
  return (
    <Link href="/play/inbox" aria-label={unread ? `${unread} unread messages` : "Messages"} className="row" style={{ gap: 2, color: "var(--muted)", position: "relative" }}>
      <Icon name="bell" size={20} />
      {unread > 0 && (
        <span className="pill bad" style={{ padding: "0 6px", fontSize: "0.7rem", position: "absolute", top: -8, right: -10 }}>
          {unread}
        </span>
      )}
    </Link>
  );
}

const NAV = [
  { href: "/play", label: "Home", icon: "home" },
  { href: "/play/learn", label: "Learn", icon: "map" },
  { href: "/play/missions", label: "Missions", icon: "flag" },
  { href: "/play/duels", label: "Duels", icon: "bolt" },
  { href: "/play/league", label: "League", icon: "trophy" },
  { href: "/play/me", label: "Me", icon: "user" },
];

/** The question player and a live duel take the whole screen. */
const isFullScreen = (path: string) => path.startsWith("/play/session") || /^\/play\/(duels|tests)\/[^/]+/.test(path);

function TopBar() {
  const { profile } = usePlayer();
  const path = usePathname();
  // The question player and live duels show their own progress.
  if (isFullScreen(path)) return <div style={{ height: 12 }} />;
  if (!profile) return <div className="play-top" style={{ height: 52 }} />;
  return (
    <div className="play-top spread" aria-label="Your stats">
      <span className="pill accent" title="Weekly league division">
        <Icon name="trophy" size={14} /> {DIVISION_LABELS[profile.division]}
      </span>
      <div className="row" style={{ gap: 14, fontWeight: 700 }}>
        <span className="stat-streak row" style={{ gap: 4 }} title={profile.streak.atRisk ? "Practise today to keep your streak" : "Day streak"}>
          <Icon name="flame" size={18} /> {profile.streak.days}
        </span>
        <span className="stat-xp row" style={{ gap: 4 }} title="Total XP">
          <Icon name="bolt" size={18} /> {profile.xp}
        </span>
        <span className="stat-heart row" style={{ gap: 4 }} title="Hearts for Learn practice">
          <Icon name="heart" size={18} /> {profile.hearts}
        </span>
        <InboxBell />
      </div>
    </div>
  );
}

function BottomNav() {
  const path = usePathname();
  if (isFullScreen(path)) return null;
  return (
    <nav className="play-nav" aria-label="Main">
      <div className="play-nav-inner">
        {NAV.map((n) => {
          const active = n.href === "/play" ? path === "/play" : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <span className="icon">
                <Icon name={n.icon} size={22} />
              </span>
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function PlayLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate area="play">
      <PlayerProvider>
        <div className="play-shell">
          <TopBar />
          {children}
        </div>
        <BottomNav />
      </PlayerProvider>
    </AuthGate>
  );
}
