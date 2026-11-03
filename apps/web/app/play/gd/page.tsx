"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { GD_DIMENSIONS, GD_TOPIC_KINDS, type GdParticipation, type GdPersona, type GdSpeaker, type GdTopic } from "@playcode/core";
import { Bar, ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import { speakInTurn, speechInputSupported, speechOutputSupported, stopSpeaking, useDictation } from "@/lib/speech";

interface Scorecard {
  scores: Record<string, number>;
  overall: number;
  strengths: string[];
  improvements: string[];
  summary: string;
  missedPoints: string[];
  participation: GdParticipation;
}

interface Gd {
  id: string;
  topic: GdTopic;
  status: "active" | "finished" | "abandoned";
  phase: "discussion" | "summary";
  personas: GdPersona[];
  turns: { speaker: GdSpeaker; name: string; text: string; summary?: boolean }[];
  contributionsLeft: number;
  roundsLeft: number;
  scorecard: Scorecard | null;
}

interface Mine {
  available: boolean;
  reason: string | null;
  weeklyLeft: number;
  active: string | null;
  topics: (GdTopic & { done: boolean })[];
  personas: GdPersona[];
  discussions: { id: string; topic: GdTopic; status: Gd["status"]; overall: number | null; startedAt: string }[];
}

// A different pitch for each participant, so they can be told apart when read aloud.
const PITCH: Partial<Record<GdSpeaker, number>> = { moderator: 0.9, ananya: 1.15, rohit: 0.8, meera: 1.3 };

const TIPS = [
  "Open with a definition, a fact or a question to frame the topic.",
  "Refer to others by name and build on or answer their points.",
  "Keep each point short, and back it with an example.",
  "Bring in someone who hasn't spoken; it shows leadership.",
  "Summarise both sides neutrally, without new arguments.",
];

function ScorecardView({ card }: { card: Scorecard }) {
  const t = useT();
  const p = card.participation;
  return (
    <div className="card stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>{t("Your scorecard")}</h2>
        <span className={`pill ${card.overall >= 4 ? "good" : card.overall === 3 ? "warn" : "bad"}`}>{t("Overall {n}/5", { n: card.overall })}</span>
      </div>
      <p style={{ margin: 0 }}>{card.summary}</p>
      <div className="row wrap small">
        <span className="pill">{t("Spoke {n} times", { n: p.contributions })}</span>
        <span className="pill">{t("{n}% of the words", { n: p.sharePct })}</span>
        <span className="pill">{t(p.initiated ? "Opened the discussion" : "Didn't open")}</span>
        <span className="pill">{t(p.summarised ? "Gave the summary" : "No summary")}</span>
      </div>
      {GD_DIMENSIONS.map(([key, label]) => {
        const n = card.scores[key] ?? 0;
        return (
          <div key={key}>
            <div className="spread small">
              <span>{t(label)}</span>
              <b>{n}/5</b>
            </div>
            <Bar value={n * 20} tone={n >= 4 ? "good" : n === 3 ? "warn" : "bad"} label={t(label)} />
          </div>
        );
      })}
      {(
        [
          ["What went well", card.strengths],
          ["To work on", card.improvements],
          ["Points you could have made", card.missedPoints],
        ] as const
      ).map(([title, items]) =>
        items.length ? (
          <div key={title}>
            <b className="small">{t(title)}</b>
            <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {items.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

function Room({ initial, onDone }: { initial: Gd; onDone: () => void }) {
  const t = useT();
  const [gd, setGd] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"speak" | "listen" | "wrap" | "finish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [gd.turns.length, busy]);

  // Voice: dictate points into the box, and hear the others speak.
  const [voice, setVoice] = useState({ input: false, output: false });
  useEffect(() => setVoice({ input: speechInputSupported(), output: speechOutputSupported() }), []);
  const [readAloud, setReadAloud] = useState(false);
  const dictation = useDictation();
  const heard = useRef(gd.turns.length);
  useEffect(() => {
    const fresh = gd.turns.slice(heard.current).filter((x) => x.speaker !== "student");
    heard.current = gd.turns.length;
    if (readAloud && fresh.length) speakInTurn(fresh.map((x) => ({ text: `${x.name}. ${x.text}`, pitch: PITCH[x.speaker] })));
  }, [gd.turns, readAloud]);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    if (dictation.listening || dictation.text) setText(dictation.text);
  }, [dictation.text, dictation.listening]);

  function toggleMic() {
    if (dictation.listening) return dictation.stop();
    stopSpeaking();
    dictation.start(text);
  }

  async function act(kind: NonNullable<typeof busy>, body: object = {}) {
    if (dictation.listening) dictation.stop();
    setBusy(kind);
    setError(null);
    try {
      setGd(await api<Gd>(`/student/gd/${gd.id}/${kind}`, { body }));
      if (kind === "speak") {
        setText("");
        dictation.reset();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function send(e: FormEvent) {
    e.preventDefault();
    void act("speak", { text });
  }

  const summary = gd.phase === "summary";
  const styleOf = (speaker: GdSpeaker) =>
    speaker === "moderator"
      ? { alignSelf: "center", background: "var(--surface-2)", maxWidth: "94%" }
      : speaker === "student"
        ? { alignSelf: "flex-end", background: "var(--accent-soft)", maxWidth: "88%" }
        : { alignSelf: "flex-start", background: "var(--surface)", maxWidth: "88%" };

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <div className="small muted">{t("Group discussion")}</div>
          <h1 style={{ margin: 0 }}>{gd.topic.title}</h1>
        </div>
        {gd.status === "active" && (
          <button
            className="btn ghost small"
            disabled={busy !== null}
            onClick={() => window.confirm(t("End the discussion now? With at least two contributions you still get a scorecard.")) && act("finish")}
          >
            {t("End")}
          </button>
        )}
      </div>
      {gd.status === "active" && voice.output && (
        <label className="row small" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={readAloud}
            onChange={(e) => {
              setReadAloud(e.target.checked);
              if (!e.target.checked) stopSpeaking();
            }}
            style={{ width: "auto" }}
          />
          {t("Read the others aloud")}
        </label>
      )}
      <details className="card tight small">
        <summary>{t("Who's in the room")}</summary>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {gd.personas.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b>: {t(p.style)}
            </li>
          ))}
        </ul>
      </details>
      <div className="stack" style={{ gap: 8 }} aria-label={t("Discussion")} role="log">
        {gd.turns.map((turn, i) => (
          <div key={i} className="card tight" style={{ ...styleOf(turn.speaker), whiteSpace: "pre-wrap" }}>
            <div className="small" style={{ fontWeight: 600 }}>
              {turn.speaker === "student" ? t("You") : turn.name}
              {turn.summary ? ` · ${t("summary")}` : ""}
            </div>
            {turn.text}
          </div>
        ))}
        {(busy === "speak" || busy === "listen") && !summary && <div className="small muted">{t("The others are responding...")}</div>}
        {(busy === "finish" || (busy === "speak" && summary)) && <div className="small muted">{t("Writing your scorecard...")}</div>}
        <div ref={end} />
      </div>
      {gd.status === "active" ? (
        <form className="stack" onSubmit={send} style={{ gap: 8 }}>
          <textarea
            className="prose"
            aria-label={t(summary ? "Your summary" : "Your point")}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1500}
            placeholder={t(summary ? "Sum up the main views fairly, in a few sentences, without new arguments." : "Make your point, or respond to someone by name.")}
            disabled={busy !== null || dictation.listening}
          />
          {dictation.error && <ErrorBox message={t(dictation.error)} />}
          {error && <ErrorBox message={error} />}
          <div className="spread wrap" style={{ gap: 8 }}>
            <span className="small muted" aria-live="polite" style={{ whiteSpace: "nowrap" }}>
              {dictation.listening ? t("Listening...") : summary ? t("The moderator asked for a summary") : t("{n} turns left", { n: gd.contributionsLeft })}
            </span>
            <div className="row wrap">
              {summary ? (
                <button type="button" className="btn" disabled={busy !== null} onClick={() => act("finish")}>
                  {t("End without a summary")}
                </button>
              ) : (
                <>
                  <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => act("wrap")}>
                    {t("Wrap up")}
                  </button>
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => act("listen")}>
                    {t("Let others speak")}
                  </button>
                </>
              )}
              {voice.input && (
                <button type="button" className={`btn ${dictation.listening ? "danger" : ""}`} disabled={busy !== null} aria-pressed={dictation.listening} onClick={toggleMic}>
                  {t(dictation.listening ? "Stop mic" : "Use mic")}
                </button>
              )}
              <button className="btn primary" disabled={busy !== null || text.trim().length < 2}>
                {t(summary ? "Give summary" : "Speak")}
              </button>
            </div>
          </div>
        </form>
      ) : gd.scorecard ? (
        <ScorecardView card={gd.scorecard} />
      ) : (
        <div className="card muted">{t("This discussion ended before you had said enough to score.")}</div>
      )}
      {gd.status !== "active" && (
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={onDone}>
          {t("Back to group discussions")}
        </button>
      )}
    </div>
  );
}

function GdHome() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const openId = useSearchParams().get("id");
  const mine = useApi<Mine>("/student/gd");
  const current = useApi<Gd>(openId ? `/student/gd/${openId}` : null);
  const [topicId, setTopicId] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const gd = await api<Gd>("/student/gd", { body: topicId ? { topicId } : {} });
      router.push(`/play/gd?id=${gd.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setStarting(false);
    }
  }

  if (openId) {
    if (current.loading && !current.data) return <Loading />;
    if (current.error || !current.data) return <ErrorBox message={current.error?.message ?? t("Could not load")} onRetry={current.reload} />;
    return (
      <Room
        key={current.data.id}
        initial={current.data}
        onDone={() => {
          router.push("/play/gd");
          void mine.reload();
        }}
      />
    );
  }
  if (mine.loading && !mine.data) return <Loading />;
  if (mine.error || !mine.data) return <ErrorBox message={mine.error?.message ?? t("Could not load")} onRetry={mine.reload} />;
  const d = mine.data;
  const kinds = Object.keys(GD_TOPIC_KINDS) as (keyof typeof GD_TOPIC_KINDS)[];
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{t("Group discussion")}</h1>
      <div className="card stack">
        <p style={{ margin: 0 }}>
          {t("Practise the GD round with three AI participants and a moderator. Each turn, make a point or let the others speak; at the end, sum up. You get a scorecard on your ideas, communication, listening, leadership and summary.")}
        </p>
        {d.active ? (
          <button className="btn primary" onClick={() => router.push(`/play/gd?id=${d.active}`)}>
            {t("Continue your discussion")}
          </button>
        ) : !d.available ? (
          <div className="small muted">{d.reason}</div>
        ) : (
          <>
            <label className="stack" style={{ gap: 4 }}>
              <span className="small" style={{ fontWeight: 600 }}>
                {t("Topic")}
              </span>
              <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                <option value="">{t("Pick one for me")}</option>
                {kinds.map((k) => (
                  <optgroup key={k} label={t(GD_TOPIC_KINDS[k])}>
                    {d.topics
                      .filter((tp) => tp.kind === k)
                      .map((tp) => (
                        <option key={tp.id} value={tp.id}>
                          {tp.title}
                          {tp.done ? ` (${t("done")})` : ""}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button className="btn primary" disabled={starting || d.weeklyLeft === 0} onClick={start}>
              {starting ? t("Starting...") : t("Start discussion")}
            </button>
            <div className="small muted">{d.weeklyLeft ? t("{n} discussions left this week", { n: d.weeklyLeft }) : t("You have used this week's discussions. Work on the points from your scorecard meanwhile.")}</div>
          </>
        )}
        {error && <ErrorBox message={error} />}
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t("Who's in the room")}</h2>
        {d.personas.map((p) => (
          <div key={p.id} className="small">
            <b>{p.name}</b>: {t(p.style)}
          </div>
        ))}
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t("What recruiters look for")}</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {TIPS.map((tip) => (
            <li key={tip}>{t(tip)}</li>
          ))}
        </ul>
      </div>
      {d.discussions.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t("Past discussions")}</h2>
          {d.discussions.map((g) => (
            <button key={g.id} className="spread" style={{ all: "unset", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8 }} onClick={() => router.push(`/play/gd?id=${g.id}`)}>
              <span>
                {g.topic.title} <span className="small muted">· {new Date(g.startedAt).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short" })}</span>
              </span>
              {g.overall ? <span className="pill">{g.overall}/5</span> : <span className="small muted">{t(g.status === "active" ? "In progress" : "Not scored")}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GdPage() {
  return (
    <Suspense fallback={<Loading />}>
      <GdHome />
    </Suspense>
  );
}
