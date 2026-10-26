"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLiveEvents } from "@/lib/realtime";
import type { QuestionView } from "@/lib/types";

interface HostView {
  id: string;
  title: string;
  code: string;
  isHost: boolean;
  status: "lobby" | "question" | "reveal" | "ended";
  index: number;
  total: number;
  endsAt: string | null;
  question: Omit<QuestionView, "hintsUsed" | "coachUsed"> | null;
  answer: { text: string; explanation: string; optionId: string | null } | null;
  answered: number;
  correct: number | null;
  spread: Record<string, number> | null;
  players: number;
  leaderboard: { name: string; score: number; rank: number }[];
}

function useSecondsLeft(endsAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return endsAt ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 1000)) : null;
}

function Leaderboard({ rows }: { rows: HostView["leaderboard"] }) {
  if (rows.length === 0) return null;
  return (
    <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }} aria-label="Leaderboard">
      {rows.map((r, i) => (
        <li key={i} className="spread" style={{ fontSize: i < 3 ? "1.15rem" : undefined, fontWeight: i < 3 ? 700 : 500 }}>
          <span>
            {r.rank}. {r.name}
          </span>
          <span>{r.score}</span>
        </li>
      ))}
    </ol>
  );
}

export default function HostScreen() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload, setData } = useApi<HostView>(`/console/live/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const secondsLeft = useSecondsLeft(data?.status === "question" ? data.endsAt : null);
  useLiveEvents((e) => {
    if (e.type === "live_quiz" && e.quizId === id) void reload();
  });
  // Poll as a fallback, and catch the moment the timer runs out.
  useEffect(() => {
    if (!data || data.status === "ended") return;
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [data?.status, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (secondsLeft === 0) void reload();
  }, [secondsLeft, reload]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  async function act(action: "next" | "end") {
    if (action === "end" && !window.confirm("End the quiz now?")) return;
    setBusy(true);
    setActionError(null);
    try {
      setData(await api<HostView>(`/console/live/${id}/${action}`, { body: {} }));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const next =
    data.status === "lobby" ? "Start the quiz" : data.status === "question" ? "Reveal the answer" : data.index >= data.total - 1 ? "Show final results" : "Next question";
  const joinUrl = typeof window === "undefined" ? "" : `${window.location.origin}/play/live`;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread wrap">
        <div>
          <Link href="/console/live" className="small muted">
            Live quiz
          </Link>
          <h1 style={{ margin: 0 }}>{data.title}</h1>
        </div>
        <div className="row wrap">
          <span className="small muted">
            {data.players} joined{data.status !== "lobby" && data.status !== "ended" ? ` · question ${data.index + 1} of ${data.total}` : ""}
          </span>
          {data.isHost && data.status !== "ended" && (
            <>
              <button className="btn primary" disabled={busy} onClick={() => act("next")}>
                {next}
              </button>
              <button className="btn ghost small" disabled={busy} onClick={() => act("end")}>
                End
              </button>
            </>
          )}
        </div>
      </div>
      {actionError && <ErrorBox message={actionError} />}

      {data.status === "lobby" && (
        <div className="card stack" style={{ alignItems: "center", textAlign: "center", padding: 32 }}>
          <div className="muted">Join at {joinUrl} with the code</div>
          <div style={{ fontSize: "4rem", fontWeight: 800, letterSpacing: "0.15em" }} aria-label={`Join code ${data.code.split("").join(" ")}`}>
            {data.code}
          </div>
          <div className="small muted">{data.players === 0 ? "Waiting for students to join..." : `${data.players} student${data.players === 1 ? " has" : "s have"} joined`}</div>
        </div>
      )}

      {data.question && (data.status === "question" || data.status === "reveal") && (
        <div className="card stack" style={{ gap: 12 }}>
          <div className="spread">
            <span className="pill accent">{data.question.typeLabel}</span>
            {data.status === "question" ? (
              <span className="kpi" aria-live="off" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}s
              </span>
            ) : (
              <span className="pill">Time&apos;s up</span>
            )}
          </div>
          <h2 style={{ fontSize: "1.5rem", whiteSpace: "pre-line", margin: 0 }}>{data.question.body.stem}</h2>
          {data.question.body.code && <CodeBlock code={data.question.body.code} />}
          {data.question.body.options && (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              {data.question.body.options.map((o, i) => {
                const right = data.answer?.optionId === o.id;
                const count = data.spread?.[o.id] ?? 0;
                return (
                  <div key={o.id} className="card tight" style={{ borderColor: right ? "var(--good-ink)" : undefined, borderWidth: right ? 2 : undefined, whiteSpace: "pre-wrap", fontFamily: o.code ? "var(--mono)" : undefined }}>
                    {/* Labelled by position: options are shuffled the same way on every phone. */}
                    <b>{"ABCDEFGH"[i]}.</b> {o.text}
                    {data.spread && <div className="small muted">{count} answer{count === 1 ? "" : "s"}</div>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="small muted">
            {data.answered} of {data.players} answered{data.correct != null ? ` · ${data.correct} right` : ""}
          </div>
          {data.answer && (
            <div className="card tight" style={{ borderColor: "var(--good-ink)" }}>
              <b>Answer: {data.answer.text}</b>
              <div className="small">{data.answer.explanation}</div>
            </div>
          )}
          {data.status === "reveal" && <Leaderboard rows={data.leaderboard.slice(0, 5)} />}
        </div>
      )}

      {data.status === "ended" && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Final results</h2>
          <Leaderboard rows={data.leaderboard} />
        </div>
      )}
    </div>
  );
}
