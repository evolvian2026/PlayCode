"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { draftToResponse, emptyDraft, QuestionInput, type Draft } from "@/components/QuestionInput";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useLiveEvents } from "@/lib/realtime";
import type { QuestionView } from "@/lib/types";

interface PlayerView {
  id: string;
  title: string;
  status: "lobby" | "question" | "reveal" | "ended";
  index: number;
  total: number;
  endsAt: string | null;
  question: Omit<QuestionView, "hintsUsed" | "coachUsed"> | null;
  answered: boolean;
  result: { correct: boolean; points: number; answered: boolean; answer: string } | null;
  me: { score: number; rank: number; of: number } | null;
  leaderboard: { name: string; score: number; rank: number }[];
}

export default function LivePlayer() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<PlayerView>(`/student/live/${id}`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useLiveEvents((e) => {
    if (e.type === "live_quiz" && e.quizId === id) void reload();
  });
  useEffect(() => {
    if (!data || data.status === "ended") return;
    const poll = setInterval(() => void reload(), 3000);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [data?.status, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  // A fresh answer box for each question.
  useEffect(() => {
    setDraft(data?.question ? emptyDraft({ ...data.question, hintsUsed: 0, coachUsed: 0 } as QuestionView) : null);
    setActionError(null);
  }, [data?.question?.id, data?.index]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const secondsLeft = data.endsAt ? Math.max(0, Math.ceil((new Date(data.endsAt).getTime() - now) / 1000)) : null;
  const question = data.question ? ({ ...data.question, hintsUsed: 0, coachUsed: 0 } as QuestionView) : null;

  async function send() {
    if (!question || !draft) return;
    const response = draftToResponse(draft);
    if (!response) return;
    setSending(true);
    setActionError(null);
    try {
      await api(`/student/live/${id}/answer`, { body: { index: data!.index, response } });
      await reload();
    } catch (e) {
      setActionError(errorMessage(e));
      await reload();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <h1 style={{ margin: 0, fontSize: "1.2rem" }}>{data.title}</h1>
        {data.me && (
          <span className="pill accent">
            {data.me.score} {t("points")}
          </span>
        )}
      </div>

      {data.status === "lobby" && <div className="card muted" role="status">{t("You're in. The quiz starts when your teacher begins.")}</div>}

      {data.status === "question" && (
        <div className="stack">
          <div className="spread small">
            <span>{t("Question {n} of {total}", { n: data.index + 1, total: data.total })}</span>
            {secondsLeft != null && <b aria-live="off">{secondsLeft}s</b>}
          </div>
          {question && draft ? (
            <>
              <h2 style={{ fontSize: "1.1rem", whiteSpace: "pre-line", margin: 0 }}>{question.body.stem}</h2>
              <QuestionInput question={question} draft={draft} onChange={setDraft} onSubmit={send} answer={null} />
              {actionError && <ErrorBox message={actionError} />}
              <button className="btn primary big" disabled={sending || !draftToResponse(draft) || secondsLeft === 0} onClick={send}>
                {sending ? t("Sending...") : t("Lock in my answer")}
              </button>
            </>
          ) : (
            <div className="card muted" role="status">{data.answered ? t("Answer locked in. Wait for the reveal.") : t("Time's up.")}</div>
          )}
        </div>
      )}

      {(data.status === "reveal" || data.status === "ended") && data.result && (
        <div className="card stack" role="status" style={{ borderColor: data.result.correct ? "var(--good-ink)" : "var(--bad-ink)" }}>
          <b>{data.result.correct ? t("Right! +{n} points", { n: data.result.points }) : data.result.answered ? t("Not this time") : t("No answer")}</b>
          <div className="small">
            {t("Answer")}: {data.result.answer}
          </div>
        </div>
      )}

      {(data.status === "reveal" || data.status === "ended") && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{data.status === "ended" ? t("Final results") : t("Leaderboard")}</h2>
          {data.me && <div className="small">{t("You are {rank} of {n}", { rank: data.me.rank, n: data.me.of })}</div>}
          <ol className="small" style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {data.leaderboard.map((r, i) => (
              <li key={i}>
                {r.rank}. {r.name} · {r.score}
              </li>
            ))}
          </ol>
          {data.status === "ended" && (
            <Link href="/play" className="btn" style={{ alignSelf: "flex-start" }}>
              {t("Back to home")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
