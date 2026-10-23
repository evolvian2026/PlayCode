"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { speak, speechInputSupported, speechOutputSupported, stopSpeaking, useDictation } from "@/lib/speech";
import { startAndOpen } from "@/lib/start";

type Track = "service" | "product";
type Mode = "text" | "voice";

interface Delivery {
  spokenAnswers: number;
  wordsPerMinute: number;
  fillersPer100Words: number;
  pace: "slow" | "good" | "fast";
  tips: string[];
}

interface Scorecard {
  scores: { problemSolving: number; fundamentals: number; communication: number; code: number };
  overall: number;
  strengths: string[];
  improvements: string[];
  summary: string;
  practise: { id: string; name: string }[];
  delivery?: Delivery | null;
}

interface Interview {
  id: string;
  track: Track;
  mode: Mode;
  status: "active" | "finished" | "abandoned";
  focusSkills: { id: string; name: string }[];
  turns: { role: "interviewer" | "candidate"; text: string; at: string; voice?: { wpm: number; fillers: number } }[];
  answersLeft: number;
  scorecard: Scorecard | null;
}

interface Mine {
  available: boolean;
  reason: string | null;
  weeklyLeft: number;
  active: string | null;
  interviews: { id: string; track: Track; mode: Mode; status: Interview["status"]; overall: number | null; answers: number; startedAt: string }[];
}

const SCORE_LABELS: [keyof Scorecard["scores"], string][] = [
  ["problemSolving", "Problem solving"],
  ["fundamentals", "Fundamentals"],
  ["communication", "Communication"],
  ["code", "Code"],
];

function ScorecardView({ card }: { card: Scorecard }) {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>{t("Your scorecard")}</h2>
        <span className={`pill ${card.overall >= 4 ? "good" : card.overall === 3 ? "warn" : "bad"}`}>{t("Overall {n}/5", { n: card.overall })}</span>
      </div>
      <p style={{ margin: 0 }}>{card.summary}</p>
      {SCORE_LABELS.map(([key, label]) => (
        <div key={key}>
          <div className="spread small">
            <span>{t(label)}</span>
            <b>{card.scores[key]}/5</b>
          </div>
          <Bar value={card.scores[key] * 20} tone={card.scores[key] >= 4 ? "good" : card.scores[key] === 3 ? "warn" : "bad"} />
        </div>
      ))}
      <div>
        <b className="small">{t("What went well")}</b>
        <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {card.strengths.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
      <div>
        <b className="small">{t("To work on")}</b>
        <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {card.improvements.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
      {card.delivery && (
        <div>
          <b className="small">{t("How you spoke")}</b>
          <div className="small">
            {t("{wpm} words a minute ({pace}) · {fillers} filler words per 100", {
              wpm: card.delivery.wordsPerMinute,
              pace: t(card.delivery.pace === "good" ? "a good pace" : card.delivery.pace === "slow" ? "slow" : "fast"),
              fillers: card.delivery.fillersPer100Words,
            })}
          </div>
          <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {card.delivery.tips.map((s) => (
              <li key={s}>{t(s)}</li>
            ))}
          </ul>
        </div>
      )}
      {card.practise.length > 0 && (
        <div className="row wrap">
          <span className="small muted">{t("Practise next:")}</span>
          {card.practise.map((s) => (
            <button key={s.id} className="btn small" onClick={async () => setError(await startAndOpen({ kind: "skill", skillId: s.id }, router.push))}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}

function Conversation({ initial, onDone }: { initial: Interview; onDone: () => void }) {
  const t = useT();
  const [iv, setIv] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"answer" | "finish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [iv.turns.length, busy]);

  // Voice: read each new question aloud, and dictate answers into the text box.
  const voice = iv.mode === "voice";
  const canDictate = voice && speechInputSupported();
  const [readAloud, setReadAloud] = useState(voice && speechOutputSupported());
  const dictation = useDictation();
  const dictated = useRef("");
  const lastTurn = iv.turns.at(-1);
  const spokenTurns = useRef(new Set<number>());
  useEffect(() => {
    const index = iv.turns.length - 1;
    if (!readAloud || iv.status !== "active" || lastTurn?.role !== "interviewer" || spokenTurns.current.has(index)) return;
    spokenTurns.current.add(index);
    speak(lastTurn.text);
  }, [iv.turns.length, iv.status, lastTurn, readAloud]);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    if (dictation.listening || dictation.text) {
      setText(dictation.text);
      dictated.current = dictation.text;
    }
  }, [dictation.text, dictation.listening]);

  function toggleMic() {
    if (dictation.listening) return dictation.stop();
    stopSpeaking();
    dictation.start(text);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const spokenMs = dictation.spokenMs();
    if (dictation.listening) dictation.stop();
    setBusy("answer");
    setError(null);
    const spoken = spokenMs >= 500 ? { durationMs: Math.min(600_000, Math.round(spokenMs)), edited: text.trim() !== dictated.current.trim() } : undefined;
    try {
      setIv(await api<Interview>(`/student/interviews/${iv.id}/answer`, { body: { text, ...(spoken ? { voice: spoken } : {}) } }));
      setText("");
      dictation.reset();
      dictated.current = "";
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function finish() {
    if (!window.confirm(t("End the interview now? With at least two answers you still get a scorecard."))) return;
    setBusy("finish");
    try {
      setIv(await api<Interview>(`/student/interviews/${iv.id}/finish`, { body: {} }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1 style={{ margin: 0 }}>{t(iv.track === "product" ? "Product company interview" : "Service company interview")}</h1>
          {iv.focusSkills.length > 0 && <div className="small muted">{t("Focus: {skills}", { skills: iv.focusSkills.map((s) => s.name).join(", ") })}</div>}
          {voice && iv.status === "active" && speechOutputSupported() && (
            <label className="row small" style={{ gap: 6, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={readAloud}
                onChange={(e) => {
                  setReadAloud(e.target.checked);
                  if (!e.target.checked) stopSpeaking();
                }}
              />
              {t("Read questions aloud")}
            </label>
          )}
        </div>
        {iv.status === "active" && (
          <button className="btn ghost small" disabled={busy !== null} onClick={finish}>
            {t("End")}
          </button>
        )}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {iv.turns.map((turn, i) => (
          <div
            key={i}
            className="card tight"
            style={{
              alignSelf: turn.role === "interviewer" ? "flex-start" : "flex-end",
              maxWidth: "88%",
              background: turn.role === "interviewer" ? "var(--surface)" : "var(--accent-soft)",
              whiteSpace: "pre-wrap",
            }}
          >
            {turn.text}
            {voice && turn.role === "interviewer" && speechOutputSupported() && (
              <button type="button" className="btn ghost small" style={{ marginLeft: 6 }} aria-label={t("Hear again")} onClick={() => speak(turn.text)}>
                {t("Hear again")}
              </button>
            )}
            {turn.voice && <div className="small muted">{t("Spoken · {wpm} words a minute", { wpm: turn.voice.wpm })}</div>}
          </div>
        ))}
        {busy === "answer" && <div className="small muted">{t("The interviewer is thinking...")}</div>}
        {busy === "finish" && <div className="small muted">{t("Writing your scorecard...")}</div>}
        <div ref={end} />
      </div>
      {iv.status === "active" ? (
        <form className="stack" onSubmit={send} style={{ gap: 8 }}>
          <textarea
            aria-label={t("Your answer")}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            placeholder={t(canDictate ? "Press Speak and answer out loud. You can fix the words before sending." : "Answer as you would in the room. Explain your thinking.")}
            disabled={busy !== null || dictation.listening}
          />
          {voice && !canDictate && <div className="small muted">{t("This browser can't turn speech into text. Type your answers, or open PlayCode in Chrome or Edge.")}</div>}
          {dictation.error && <ErrorBox message={t(dictation.error)} />}
          {error && <ErrorBox message={error} />}
          <div className="spread">
            <span className="small muted" aria-live="polite">
              {dictation.listening ? t("Listening...") : t("{n} answers left", { n: iv.answersLeft })}
            </span>
            <div className="row">
              {canDictate && (
                <button type="button" className={`btn ${dictation.listening ? "danger" : ""}`} disabled={busy !== null} aria-pressed={dictation.listening} onClick={toggleMic}>
                  {t(dictation.listening ? "Stop" : "Speak")}
                </button>
              )}
              <button className="btn primary" disabled={busy !== null || !text.trim()}>
                {t("Send")}
              </button>
            </div>
          </div>
        </form>
      ) : iv.scorecard ? (
        <ScorecardView card={iv.scorecard} />
      ) : (
        <div className="card muted">{t("This interview ended before there was enough to score.")}</div>
      )}
      {iv.status !== "active" && (
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={onDone}>
          {t("Back to interviews")}
        </button>
      )}
    </div>
  );
}

function InterviewHome() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("id");
  const [track, setTrack] = useState<Track>(params.get("track") === "product" ? "product" : "service");
  const [mode, setMode] = useState<Mode>("text");
  const [voiceOk, setVoiceOk] = useState(false);
  useEffect(() => setVoiceOk(speechInputSupported()), []);
  const mine = useApi<Mine>("/student/interviews");
  const current = useApi<Interview>(openId ? `/student/interviews/${openId}` : null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const iv = await api<Interview>("/student/interviews", { body: { track, mode } });
      router.push(`/play/interview?id=${iv.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setStarting(false);
    }
  }

  if (openId) {
    if (current.loading && !current.data) return <Loading />;
    if (current.error || !current.data) return <ErrorBox message={current.error?.message ?? t("Could not load")} onRetry={current.reload} />;
    return (
      <Conversation
        key={current.data.id}
        initial={current.data}
        onDone={() => {
          router.push("/play/interview");
          void mine.reload();
        }}
      />
    );
  }
  if (mine.loading && !mine.data) return <Loading />;
  if (mine.error || !mine.data) return <ErrorBox message={mine.error?.message ?? t("Could not load")} onRetry={mine.reload} />;
  const d = mine.data;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Mock interview")}</h1>
      <div className="card stack">
        <p style={{ margin: 0 }}>{t("A short technical interview with an AI interviewer, about 15 minutes. It asks about the skills you are weakest in, follows up like a real panel, and ends with a scorecard.")}</p>
        {d.active ? (
          <button className="btn primary" onClick={() => router.push(`/play/interview?id=${d.active}`)}>
            {t("Continue your interview")}
          </button>
        ) : !d.available ? (
          <div className="small muted">{d.reason}</div>
        ) : (
          <>
            <div className="row wrap">
              {(["service", "product"] as const).map((k) => (
                <button key={k} className={`btn small ${track === k ? "primary" : ""}`} onClick={() => setTrack(k)}>
                  {t(k === "service" ? "Service company" : "Product company")}
                </button>
              ))}
            </div>
            <div className="row wrap" role="group" aria-label={t("Answer by")}>
              {(["text", "voice"] as const).map((m) => (
                <button key={m} className={`btn small ${mode === m ? "primary" : ""}`} aria-pressed={mode === m} disabled={m === "voice" && !voiceOk} onClick={() => setMode(m)}>
                  {t(m === "text" ? "Type answers" : "Speak answers")}
                </button>
              ))}
            </div>
            {mode === "voice" ? (
              <div className="small muted">{t("Questions are read aloud and you answer out loud, as in a real interview. Your browser turns speech into text (Chrome and Edge use their speech service); PlayCode keeps only the text and how long you spoke.")}</div>
            ) : (
              !voiceOk && <div className="small muted">{t("Speaking answers needs Chrome, Edge or Safari.")}</div>
            )}
            <button className="btn primary" disabled={starting || d.weeklyLeft === 0} onClick={start}>
              {starting ? t("Starting...") : t("Start interview")}
            </button>
            <div className="small muted">{d.weeklyLeft ? t("{n} interviews left this week", { n: d.weeklyLeft }) : t("You have used this week's interviews. Practise the skills from your scorecard meanwhile.")}</div>
          </>
        )}
        {error && <ErrorBox message={error} />}
      </div>
      {d.interviews.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t("Past interviews")}</h2>
          {d.interviews.map((iv) => (
            <button key={iv.id} className="spread" style={{ all: "unset", cursor: "pointer", display: "flex", justifyContent: "space-between" }} onClick={() => router.push(`/play/interview?id=${iv.id}`)}>
              <span>
                {t(iv.track === "product" ? "Product company" : "Service company")}
                {iv.mode === "voice" ? ` · ${t("spoken")}` : ""}{" "}
                <span className="small muted">· {new Date(iv.startedAt).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" })}</span>
              </span>
              {iv.overall ? <span className="pill">{iv.overall}/5</span> : <span className="small muted">{t(iv.status === "active" ? "In progress" : "Not scored")}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InterviewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <InterviewHome />
    </Suspense>
  );
}
