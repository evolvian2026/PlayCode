"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { draftToResponse, emptyDraft, QuestionInput, type Draft } from "@/components/QuestionInput";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { usePlayer } from "@/lib/player-state";
import { useLiveEvents } from "@/lib/realtime";
import type { QuestionView } from "@/lib/types";
import { useT } from "@/lib/i18n";

interface Side {
  userId: string;
  name: string | null;
  rating: number;
  answered: number;
  correct: number;
  finished: boolean;
  outcome: "win" | "loss" | "draw" | null;
  ratingAfter: number | null;
  xp: number;
}

interface Duel {
  id: string;
  status: "waiting" | "active" | "finished" | "expired" | "declined" | "cancelled";
  total: number;
  startsInMs: number | null;
  timeLeftMs: number | null;
  me: Side;
  opponent: Side | null;
  question: QuestionView | null;
  review: { number: number; questionId: string; correct: boolean }[] | null;
}

const fmt = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

function Progress({ side, total, label }: { side: Side; total: number; label: string }) {
  const t = useT();
  return (
    <div>
      <div className="spread small">
        <b>{label}</b>
        <span className="muted">
          {t("{n} right", { n: side.correct })} · {side.answered}/{total}
        </span>
      </div>
      <Bar value={(side.answered / total) * 100} tone={side.finished ? "good" : undefined} />
    </div>
  );
}

export default function DuelPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { refresh } = usePlayer();
  const { data, error, loading, reload, setData } = useApi<Duel>(`/student/duels/${id}`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [flash, setFlash] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Local clock so the timer ticks between server updates.
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => setFetchedAt(Date.now()), [data]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  // Poll as a fallback to live events; faster while the duel runs.
  useEffect(() => {
    if (!data || ["finished", "expired", "declined", "cancelled"].includes(data.status)) return;
    const tick = setInterval(() => void reload(), data.status === "active" ? 2000 : 4000);
    return () => clearInterval(tick);
  }, [data, reload]);
  useLiveEvents((e) => {
    if (e.type === "duel" && e.duelId === id) void reload();
  });

  const questionId = data?.question?.id;
  useEffect(() => {
    if (data?.question) setDraft(emptyDraft(data.question));
    // Reset the answer only when the question changes.
  }, [questionId]);

  const elapsed = now - fetchedAt;
  const startsIn = data?.startsInMs != null ? Math.max(0, data.startsInMs - elapsed) : null;
  const timeLeft = data?.timeLeftMs != null ? Math.max(0, data.timeLeftMs - elapsed) : null;

  // Countdown or clock reaching zero: ask the server for the next state.
  useEffect(() => {
    if (data?.status === "active" && ((startsIn === 0 && !data.question && !data.me.finished) || timeLeft === 0)) void reload();
    // Fire on the transitions to zero, not on every tick.
  }, [startsIn === 0, timeLeft === 0]);

  const submit = useCallback(
    async (d: Draft) => {
      const response = draftToResponse(d);
      if (!response || !data?.question || busy) return;
      setBusy(true);
      setActionError(null);
      try {
        const r = await api<{ correct: boolean; duel: Duel }>(`/student/duels/${id}/answer`, { body: { questionId: data.question.id, response } });
        setFlash(r.correct);
        setTimeout(() => setFlash(null), 600);
        setData(r.duel);
        if (r.duel.status === "finished") void refresh();
      } catch (e) {
        setActionError(errorMessage(e));
        void reload();
      } finally {
        setBusy(false);
      }
    },
    [data, busy, id, reload, setData, refresh],
  );

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const opp = data.opponent;

  if (data.status !== "active" && data.status !== "finished") {
    const msg = { waiting: "Waiting for an opponent...", expired: "This challenge expired.", declined: "Your challenge was declined.", cancelled: "This challenge was cancelled." }[data.status];
    return (
      <div className="stack center" style={{ paddingTop: 48 }}>
        <h1>{t(msg)}</h1>
        <Link href="/play/duels" className="btn primary">
          {t("Back to duels")}
        </Link>
      </div>
    );
  }

  if (data.status === "finished") {
    const out = data.me.outcome ?? "draw";
    const change = (data.me.ratingAfter ?? data.me.rating) - data.me.rating;
    return (
      <div className="stack center" style={{ paddingTop: 24 }}>
        <Icon name={out === "win" ? "trophy" : out === "draw" ? "flag" : "refresh"} size={64} className={out === "win" ? "stat-xp" : ""} />
        <h1>{t(out === "win" ? "You won!" : out === "draw" ? "It's a draw" : "You lost this one")}</h1>
        <p className="muted">{t("vs {name}", { name: opp?.name ?? "" })}</p>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="card">
            <div className="kpi">
              {data.me.correct} - {opp?.correct ?? 0}
            </div>
            <div className="muted small">{t("correct answers")}</div>
          </div>
          <div className="card">
            <div className="kpi">
              {change >= 0 ? "+" : ""}
              {change}
            </div>
            <div className="muted small">{t("rating ({n})", { n: data.me.ratingAfter ?? data.me.rating })}</div>
          </div>
        </div>
        <p className="stat-xp" style={{ fontWeight: 700 }}>
          +{data.me.xp} XP
        </p>
        {data.review && (
          <div className="row wrap" style={{ justifyContent: "center" }}>
            {data.review.map((r) => (
              <span key={r.number} className={`pill ${r.correct ? "good" : "bad"}`}>
                Q{r.number} {t(r.correct ? "right" : "wrong")}
              </span>
            ))}
          </div>
        )}
        <Link href="/play/duels" className="btn primary big">
          {t("Back to duels")}
        </Link>
      </div>
    );
  }

  return (
    <div className="stack" style={{ paddingBottom: 24 }}>
      <div className="spread">
        <Link href="/play/duels" className="btn ghost small" aria-label={t("Back to duels")}>
          <Icon name="back" />
        </Link>
        <span className="kpi" style={{ fontSize: "1.4rem", color: timeLeft !== null && timeLeft < 30_000 ? "var(--bad-ink)" : undefined }} aria-live="off">
          {timeLeft !== null && startsIn === 0 ? fmt(timeLeft) : "3:00"}
        </span>
      </div>
      <div className="card stack" style={{ gap: 10 }}>
        <Progress side={data.me} total={data.total} label={t("You")} />
        {opp && <Progress side={opp} total={data.total} label={opp.name ?? t("Opponent")} />}
      </div>

      {startsIn !== null && startsIn > 0 ? (
        <div className="center" style={{ paddingTop: 40 }}>
          <div className="muted">{t("Starting in")}</div>
          <div className="kpi" style={{ fontSize: "4rem" }}>
            {Math.ceil(startsIn / 1000)}
          </div>
        </div>
      ) : data.me.finished ? (
        <div className="card center stack">
          <h2>{t("All answered")}</h2>
          <p className="muted">{opp?.name ? t("Waiting for {name} to finish or for the clock to run out.", { name: opp.name }) : t("Waiting for your opponent to finish or for the clock to run out.")}</p>
        </div>
      ) : data.question && draft ? (
        <div className="stack">
          <div className="row" style={{ gap: 6 }}>
            <span className="pill accent">{t(data.question.typeLabel)}</span>
            <span className="muted small" style={{ marginLeft: "auto" }}>
              {t("Question {n} of {total}", { n: data.me.answered + 1, total: data.total })}
            </span>
          </div>
          <h2 style={{ fontSize: "1.1rem" }}>{data.question.body.stem}</h2>
          {flash !== null && (
            <div className={`pill ${flash ? "good" : "bad"}`} role="status">
              {t(flash ? "Right!" : "Wrong")}
            </div>
          )}
          <QuestionInput
            question={data.question}
            draft={draft}
            answer={null}
            onSubmit={() => submit(draft)}
            onChange={(d) => {
              setDraft(d);
              // Tapping an option answers straight away: duels are about speed.
              if (d.kind === "option") void submit(d);
            }}
          />
          {draft.kind !== "option" && (
            <button className="btn primary big" disabled={!draftToResponse(draft) || busy} onClick={() => submit(draft)}>
              {t("Submit")}
            </button>
          )}
          {actionError && <ErrorBox message={actionError} />}
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}
