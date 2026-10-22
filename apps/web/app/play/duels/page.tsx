"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ErrorBox, Loading, timeAgo } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLiveEvents } from "@/lib/realtime";

interface Lobby {
  rating: number;
  record: { wins: number; losses: number; draws: number };
  invites: { id: string; from: string; createdAt: string }[];
  live: { id: string; status: string; waitingForMatch: boolean } | null;
  recent: { id: string; opponent: string; outcome: "win" | "loss" | "draw" | null; correct: number; ratingChange: number; xp: number; finishedAt: string }[];
  classmates: { id: string; name: string; rating: number; lastActiveAt: string | null }[];
}

const OUTCOME = { win: ["Won", "good"], loss: ["Lost", "bad"], draw: ["Draw", "warn"] } as const;

export default function Duels() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Lobby>("/student/duels");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useLiveEvents((e) => {
    if (e.type === "duel_invite") void reload();
    if (e.type === "duel" && e.event === "started") router.push(`/play/duels/${e.duelId}`);
  });

  async function act(path: string, body: unknown = {}) {
    setBusy(true);
    setActionError(null);
    try {
      const d = await api<{ id: string; status: string }>(path, { body });
      if (d.status === "active") router.push(`/play/duels/${d.id}`);
      else await reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const people = data.classmates.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1 style={{ margin: 0 }}>Duels</h1>
          <p className="muted" style={{ margin: 0 }}>
            5 questions, 3 minutes, same questions for both. Most correct wins; ties go to the faster player.
          </p>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card tight center">
          <div className="kpi">{data.rating}</div>
          <div className="muted small">duel rating</div>
        </div>
        <div className="card tight center">
          <div className="kpi">
            {data.record.wins}-{data.record.losses}-{data.record.draws}
          </div>
          <div className="muted small">wins-losses-draws</div>
        </div>
      </div>
      {actionError && <ErrorBox message={actionError} />}

      {data.invites.map((i) => (
        <div key={i.id} className="card spread" style={{ background: "var(--accent-soft)", borderColor: "transparent" }}>
          <div>
            <b>{i.from}</b> challenged you
            <div className="muted small">{timeAgo(i.createdAt)}</div>
          </div>
          <div className="row">
            <button className="btn small" disabled={busy} onClick={() => act(`/student/duels/${i.id}/decline`)}>
              Decline
            </button>
            <button className="btn primary small" disabled={busy} onClick={() => act(`/student/duels/${i.id}/accept`)}>
              Accept
            </button>
          </div>
        </div>
      ))}

      {data.live ? (
        <div className="card stack">
          {data.live.status === "active" ? (
            <button className="btn primary big" onClick={() => router.push(`/play/duels/${data.live!.id}`)}>
              Return to your duel
            </button>
          ) : (
            <>
              <div className="row">
                <Icon name="refresh" />
                <span>{data.live.waitingForMatch ? "Looking for an opponent near your rating..." : "Waiting for your classmate to accept..."}</span>
              </div>
              <button className="btn small" disabled={busy} onClick={() => act(`/student/duels/${data.live!.id}/cancel`)}>
                Cancel
              </button>
            </>
          )}
        </div>
      ) : (
        <button className="btn primary big" disabled={busy} onClick={() => act("/student/duels")}>
          Find an opponent
        </button>
      )}

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Challenge a classmate</h2>
        <input placeholder="Search classmates" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search classmates" />
        {people.slice(0, 12).map((c) => (
          <div key={c.id} className="spread">
            <div>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="muted small">
                rating {c.rating} · active {timeAgo(c.lastActiveAt)}
              </div>
            </div>
            <button className="btn small" disabled={busy || Boolean(data.live)} onClick={() => act("/student/duels", { opponentId: c.id })}>
              Challenge
            </button>
          </div>
        ))}
        {people.length === 0 && <p className="muted small">No classmates found.</p>}
      </div>

      {data.recent.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Recent duels</h2>
          {data.recent.map((r) => (
            <button key={r.id} className="spread" style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }} onClick={() => router.push(`/play/duels/${r.id}`)}>
              <span>
                vs <b>{r.opponent}</b> <span className="muted small">· {r.correct}/5 correct</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                {r.outcome && <span className={`pill ${OUTCOME[r.outcome][1]}`}>{OUTCOME[r.outcome][0]}</span>}
                <span className="small muted">
                  {r.ratingChange >= 0 ? "+" : ""}
                  {r.ratingChange}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
