"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { JAM_CATEGORIES, JAM_DIMENSIONS, JAM_PREP_SECONDS, JAM_SECONDS, jamDelivery, MIN_JAM_WORDS, type JamCategory, type JamDelivery, type JamTopic } from "@playcode/core";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading, useDates } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { speechInputSupported, useDictation } from "@/lib/speech";

interface Feedback {
  scores: Record<string, number>;
  overall: number;
  strengths: string[];
  improvements: string[];
  betterOpening: string;
  outline: string[];
}

interface Talk {
  id: string;
  topic: JamTopic;
  transcript: string;
  delivery: JamDelivery;
  spokenMs: number;
  feedback: Feedback;
  createdAt: string;
}

interface Home {
  available: boolean;
  reason: string | null;
  leftToday: number;
  topics: (JamTopic & { best: number | null })[];
  attempts: { id: string; topicId: string; topic: string; overall: number; words: number; wpm: number; spokenMs: number; createdAt: string }[];
}

const tone = (n: number) => (n >= 4 ? "good" : n === 3 ? "warn" : "bad");
const PACE = { slow: "Slow", good: "Steady", fast: "Fast" } as const;

function DeliveryCard({ d }: { d: JamDelivery }) {
  const t = useT();
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}>{t("Delivery")}</h2>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div className="center">
          <div className="kpi">{d.wpm}</div>
          <div className="small muted">{t("words a minute")}</div>
          <span className={`pill ${d.pace === "good" ? "good" : "warn"}`}>{t(PACE[d.pace])}</span>
        </div>
        <div className="center">
          <div className="kpi">{d.fillersPer100Words}</div>
          <div className="small muted">{t("fillers per 100 words")}</div>
        </div>
        <div className="center">
          <div className="kpi">{d.usedPct}%</div>
          <div className="small muted">{t("of the minute used")}</div>
        </div>
      </div>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
        {d.tips.map((tip) => (
          <li key={tip}>{t(tip)}</li>
        ))}
      </ul>
      <p className="muted small" style={{ margin: 0 }}>
        {t("Measured from what your browser heard, so treat the numbers as a guide.")}
      </p>
    </div>
  );
}

function Result({ talk, onAgain, onBack }: { talk: Talk; onAgain: () => void; onBack: () => void }) {
  const t = useT();
  const f = talk.feedback;
  return (
    <div className="stack">
      <div>
        <div className="small muted">{t(JAM_CATEGORIES[talk.topic.category])}</div>
        <h1 style={{ margin: 0 }}>{talk.topic.topic}</h1>
        <div className="small muted">{t("{words} words in {seconds} seconds", { words: talk.delivery.words, seconds: Math.round(talk.spokenMs / 1000) })}</div>
      </div>
      <div className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>{t("Your feedback")}</h2>
          <span className={`pill ${tone(f.overall)}`}>{t("Overall {n}/5", { n: f.overall })}</span>
        </div>
        {JAM_DIMENSIONS.map(([key, label]) => {
          const n = f.scores[key] ?? 0;
          return (
            <div key={key}>
              <div className="spread small">
                <span>{t(label)}</span>
                <b>{n}/5</b>
              </div>
              <Bar value={n * 20} tone={tone(n)} label={t(label)} />
            </div>
          );
        })}
        {(
          [
            ["What went well", f.strengths],
            ["To work on", f.improvements],
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
        {f.betterOpening && (
          <div>
            <b className="small">{t("A stronger opening")}</b>
            <p className="small" style={{ margin: "4px 0 0", fontStyle: "italic" }}>
              {f.betterOpening}
            </p>
          </div>
        )}
        {f.outline.length > 0 && (
          <div>
            <b className="small">{t("Three points you could make")}</b>
            <ol className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {f.outline.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <DeliveryCard d={talk.delivery} />
      <details className="card">
        <summary className="small" style={{ fontWeight: 600 }}>
          {t("What we heard")}
        </summary>
        <p className="small" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
          {talk.transcript}
        </p>
      </details>
      <div className="row">
        <button className="btn primary" onClick={onAgain}>
          {t("Try another topic")}
        </button>
        <button className="btn ghost" onClick={onBack}>
          {t("All topics")}
        </button>
      </div>
    </div>
  );
}

type Stage = { kind: "prep"; topic: JamTopic; endsAt: number } | { kind: "speaking"; topic: JamTopic; endsAt: number } | { kind: "review"; topic: JamTopic; transcript: string; spokenMs: number };

/** Think, speak for a minute, then send the transcript for feedback. */
function Round({ topic, onDone, onCancel }: { topic: JamTopic; onDone: (talk: Talk) => void; onCancel: () => void }) {
  const t = useT();
  const dictation = useDictation();
  const [stage, setStage] = useState<Stage>({ kind: "prep", topic, endsAt: Date.now() + JAM_PREP_SECONDS * 1000 });
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => heading.current?.focus(), [stage.kind]);

  const speakNow = () => {
    dictation.reset();
    dictation.start();
    setStage({ kind: "speaking", topic, endsAt: Date.now() + JAM_SECONDS * 1000 });
  };
  const finish = () => {
    const spokenMs = Math.min(dictation.spokenMs(), (JAM_SECONDS + 5) * 1000);
    dictation.stop();
    setStage({ kind: "review", topic, transcript: dictation.text, spokenMs });
  };

  // The thinking time runs out: start speaking. The minute runs out: stop.
  const left = stage.kind === "review" ? 0 : Math.max(0, stage.endsAt - now);
  useEffect(() => {
    if (left > 0) return;
    if (stage.kind === "prep") speakNow();
    else if (stage.kind === "speaking") finish();
  }, [left === 0, stage.kind]);
  // The final words arrive after recognition stops.
  useEffect(() => {
    if (stage.kind === "review" && !dictation.listening && dictation.text && dictation.text !== stage.transcript) setStage({ ...stage, transcript: dictation.text });
  }, [dictation.listening, dictation.text]);

  async function send() {
    if (stage.kind !== "review") return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api<Talk>("/student/jam", { body: { topicId: topic.id, transcript: stage.transcript, spokenMs: stage.spokenMs } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const seconds = Math.ceil(left / 1000);
  return (
    <div className="stack">
      <div>
        <div className="small muted">{t(JAM_CATEGORIES[topic.category])}</div>
        <h1 ref={heading} tabIndex={-1} style={{ margin: 0 }}>
          {topic.topic}
        </h1>
      </div>
      {stage.kind === "prep" && (
        <div className="card center stack">
          <div className="muted">{t("Think of two or three points. You start speaking in")}</div>
          <div className="kpi" style={{ fontSize: "3.5rem" }} role="timer" aria-live="off">
            {seconds}
          </div>
          <button className="btn primary big" onClick={speakNow}>
            <Icon name="mic" /> {t("Start speaking now")}
          </button>
        </div>
      )}
      {stage.kind === "speaking" && (
        <div className="card stack">
          <div className="spread">
            <span className="pill bad" role="status">
              {t(dictation.listening ? "Listening..." : "Starting the microphone...")}
            </span>
            <span className="kpi" style={{ fontSize: "1.8rem", color: seconds <= 10 ? "var(--bad-ink)" : undefined }} role="timer" aria-live="off">
              0:{String(seconds).padStart(2, "0")}
            </span>
          </div>
          <Bar value={((JAM_SECONDS * 1000 - left) / (JAM_SECONDS * 1000)) * 100} label={t("Time used")} />
          <p className="small" style={{ minHeight: 80, margin: 0, whiteSpace: "pre-wrap" }} aria-live="off">
            {dictation.text || <span className="muted">{t("Your words appear here as you speak.")}</span>}
          </p>
          {dictation.error && <ErrorBox message={dictation.error} />}
          <button className="btn danger" onClick={finish}>
            {t("I'm done")}
          </button>
        </div>
      )}
      {stage.kind === "review" &&
        (() => {
          const preview = jamDelivery(stage.transcript, stage.spokenMs);
          const enough = preview.words >= MIN_JAM_WORDS;
          return (
            <>
              <div className="card stack">
                <h2 style={{ margin: 0 }}>{t("What we heard")}</h2>
                <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {stage.transcript || <span className="muted">{t("Nothing. Check that the microphone is allowed and try again.")}</span>}
                </p>
                <p className="muted small" style={{ margin: 0 }}>
                  {t("The transcript can't be edited: this is speaking practice. Misheard words are ignored when it is marked.")}
                </p>
              </div>
              <DeliveryCard d={preview} />
              {!enough && <div className="card small">{t("Speak for at least half a minute to get feedback on what you said.")}</div>}
              {error && <ErrorBox message={error} />}
              <div className="row">
                <button className="btn primary" disabled={busy || !enough} onClick={send}>
                  {t(busy ? "Marking..." : "Get feedback")}
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    dictation.reset();
                    setStage({ kind: "prep", topic, endsAt: Date.now() + JAM_PREP_SECONDS * 1000 });
                  }}
                >
                  {t("Try again")}
                </button>
              </div>
            </>
          );
        })()}
      {stage.kind !== "review" && (
        <button
          className="btn ghost small"
          onClick={() => {
            dictation.reset();
            onCancel();
          }}
        >
          {t("Cancel")}
        </button>
      )}
    </div>
  );
}

function JamPage() {
  const t = useT();
  const dates = useDates();
  const router = useRouter();
  const params = useSearchParams();
  const viewing = params.get("id");
  const home = useApi<Home>("/student/jam");
  const opened = useApi<Talk>(viewing ? `/student/jam/${viewing}` : null);
  const [topic, setTopic] = useState<JamTopic | null>(null);
  const [category, setCategory] = useState<JamCategory | "all">("all");
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(speechInputSupported()), []);

  const surprise = () => {
    const pool = home.data?.topics.filter((x) => category === "all" || x.category === category) ?? [];
    setTopic(pool[Math.floor(Math.random() * pool.length)] ?? null);
  };

  if (viewing) {
    if (opened.error) return <ErrorBox message={opened.error.message} onRetry={opened.reload} />;
    if (!opened.data) return <Loading />;
    return (
      <Result
        talk={opened.data}
        onAgain={() => {
          router.push("/play/jam");
          surprise();
        }}
        onBack={() => router.push("/play/jam")}
      />
    );
  }
  if (topic)
    return (
      <Round
        key={topic.id}
        topic={topic}
        onCancel={() => setTopic(null)}
        onDone={(talk) => {
          setTopic(null);
          void home.reload();
          router.push(`/play/jam?id=${talk.id}`);
        }}
      />
    );
  if (home.error) return <ErrorBox message={home.error.message} onRetry={home.reload} />;
  if (!home.data) return <Loading />;
  const data = home.data;
  const canStart = data.available && data.leftToday > 0 && supported;
  const shown = data.topics.filter((x) => category === "all" || x.category === category);
  // Set by a trainer: the topic comes from the link.
  const assigned = data.topics.find((x) => x.id === params.get("topic"));

  return (
    <div className="stack">
      <div>
        <Link href="/play/me" className="small">
          <Icon name="back" size={16} /> {t("Me")}
        </Link>
        <h1 style={{ margin: "4px 0 0" }}>{t("Speaking practice")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("JAM (Just A Minute): see a topic, think for {prep} seconds, then speak for a minute. You get feedback on your ideas, structure and language, and on your pace and filler words.", { prep: JAM_PREP_SECONDS })}
        </p>
      </div>
      {assigned && (
        <div className="card stack" style={{ gap: 6, borderColor: "var(--accent)" }}>
          <div className="small muted">{t("From your trainer")}</div>
          <div className="spread">
            <b>{assigned.topic}</b>
            <button className="btn primary small" disabled={!canStart} onClick={() => setTopic(assigned)}>
              {t("Speak")}
            </button>
          </div>
        </div>
      )}
      {!supported && <div className="card">{t("Speaking practice needs a browser that turns speech into text, such as Chrome on Android or on a computer.")}</div>}
      {!data.available && data.reason && <div className="card">{t(data.reason)}</div>}
      {data.available && (
        <div className="small muted">{t(data.leftToday === 1 ? "1 talk can be marked today" : "{n} talks can be marked today", { n: data.leftToday })}</div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {t("Your browser turns your speech into text. PlayCode keeps the text and how long you spoke, never a recording.")}{" "}
        <Link href="/play/speaking-drills">{t("Warm up with read-aloud and repeat drills.")}</Link>
      </p>
      <div className="row wrap" role="group" aria-label={t("Kinds of topic")} style={{ gap: 6 }}>
        {(["all", ...Object.keys(JAM_CATEGORIES)] as (JamCategory | "all")[]).map((c) => (
          <button key={c} className={`btn small ${category === c ? "primary" : ""}`} aria-pressed={category === c} onClick={() => setCategory(c)}>
            {t(c === "all" ? "All" : JAM_CATEGORIES[c])}
          </button>
        ))}
      </div>
      <button className="btn primary big" disabled={!canStart} onClick={surprise}>
        <Icon name="mic" /> {t("Surprise me with a topic")}
      </button>
      <div className="card stack" style={{ gap: 0 }}>
        {shown.map((x, i) => (
          <div key={x.id} className="spread" style={{ padding: "8px 0", borderTop: i ? "1px solid var(--border)" : undefined }}>
            <div>
              <div style={{ fontWeight: 600 }}>{x.topic}</div>
              <div className="small muted">
                {t(JAM_CATEGORIES[x.category])}
                {x.best !== null && ` · ${t("best {n}/5", { n: x.best })}`}
              </div>
            </div>
            <button className="btn small" disabled={!canStart} onClick={() => setTopic(x)}>
              {t("Speak")}
            </button>
          </div>
        ))}
      </div>
      {data.attempts.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t("Your talks")}</h2>
          {data.attempts.map((a) => (
            <Link key={a.id} href={`/play/jam?id=${a.id}`} className="spread" style={{ color: "inherit" }}>
              <span>
                <b>{a.topic}</b>
                <span className="small muted"> · {t("{n} words a minute", { n: a.wpm })} · {dates.ago(a.createdAt)}</span>
              </span>
              <span className={`pill ${tone(a.overall)}`}>{a.overall}/5</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <JamPage />
    </Suspense>
  );
}
