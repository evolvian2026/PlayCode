"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { DRILL_BANDS, DRILL_KINDS, drillBand, matchDrill, pickDrillSentences, type DrillKind, type DrillMatch, type DrillSentence } from "@playcode/core";
import { Icon } from "@/components/Icon";
import { Bar, ErrorBox, Loading, useDates } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { speak, speechInputSupported, speechOutputSupported, stopSpeaking, useDictation } from "@/lib/speech";

interface Home {
  kinds: { kind: DrillKind; best: number | null; sittings: number }[];
  sittings: { id: string; kind: DrillKind; accuracy: number; wpm: number | null; sentences: number; createdAt: string }[];
}

interface Sitting {
  id: string;
  kind: DrillKind;
  accuracy: number;
  wpm: number | null;
  createdAt: string;
  items: { sentenceId: string; text: string; heard: string; spokenMs: number; accuracy: number; words: DrillMatch["words"] }[];
}

/** Longest a single answer may run before the microphone stops by itself. */
const MAX_ANSWER_MS = 20_000;
const tone = (n: number) => (n >= 85 ? "good" : n >= 60 ? "warn" : "bad");

/** The sentence with missed words struck through. */
function Words({ words }: { words: DrillMatch["words"] }) {
  const t = useT();
  return (
    <span>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          {w.heard ? (
            w.word
          ) : (
            <span style={{ color: "var(--bad-ink)", textDecoration: "line-through" }}>
              {w.word}
              <span className="sr-only"> {t("(missed)")}</span>
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

function Result({ sitting, onAgain, onBack }: { sitting: Sitting; onAgain: () => void; onBack: () => void }) {
  const t = useT();
  const band = drillBand(sitting.accuracy);
  return (
    <div className="stack">
      <div>
        <div className="small muted">{t(DRILL_KINDS[sitting.kind].label)}</div>
        <h1 style={{ margin: 0 }}>{t("{n}% of words came through", { n: sitting.accuracy })}</h1>
        <div className="small muted">
          {t(DRILL_BANDS[band])}
          {sitting.wpm !== null && ` · ${t("{n} words a minute", { n: sitting.wpm })}`}
        </div>
      </div>
      <div className="card stack">
        {sitting.items.map((item, i) => (
          <div key={item.sentenceId} className="stack" style={{ gap: 4, borderTop: i ? "1px solid var(--border)" : undefined, paddingTop: i ? 10 : 0 }}>
            <div className="spread">
              <b className="small">{t("Sentence {n}", { n: i + 1 })}</b>
              <span className={`pill ${tone(item.accuracy)}`}>{item.accuracy}%</span>
            </div>
            <div>
              <Words words={item.words} />
            </div>
            <div className="small muted">
              {t("Heard:")} {item.heard || t("(nothing)")}
            </div>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {t("Struck-through words weren't heard. That can be the word, the speed, background noise or the microphone: say them again slowly and clearly.")}
      </p>
      <div className="row">
        <button className="btn primary" onClick={onAgain}>
          {t("New sentences")}
        </button>
        <button className="btn ghost" onClick={onBack}>
          {t("All drills")}
        </button>
      </div>
    </div>
  );
}

type Answer = { sentence: DrillSentence; heard: string; spokenMs: number; match: DrillMatch };

/** One sitting: each sentence in turn, then the score. */
function Run({ kind, onDone, onCancel }: { kind: DrillKind; onDone: (s: Sitting) => void; onCancel: () => void }) {
  const t = useT();
  const dictation = useDictation();
  const [sentences] = useState(() => pickDrillSentences(kind));
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [phase, setPhase] = useState<"ready" | "speaking" | "checking" | "checked">("ready");
  const [plays, setPlays] = useState(0);
  const [spokenMs, setSpokenMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const sentence = sentences[index]!;
  const last = answers[index];

  useEffect(() => heading.current?.focus(), [index]);
  useEffect(() => () => stopSpeaking(), []);

  const startSpeaking = () => {
    stopSpeaking();
    dictation.reset();
    dictation.start();
    setPhase("speaking");
  };
  const stopAnswer = () => {
    setSpokenMs(dictation.spokenMs());
    dictation.stop();
    setPhase("checking");
  };
  // Stop by itself if the student forgets to.
  useEffect(() => {
    if (phase !== "speaking") return;
    const timer = setTimeout(stopAnswer, MAX_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  // The last words arrive when recognition has ended.
  useEffect(() => {
    if (phase !== "checking" || dictation.listening) return;
    const heard = dictation.text.trim();
    setAnswers((a) => [...a.slice(0, index), { sentence, heard, spokenMs, match: matchDrill(sentence.text, heard) }]);
    setPhase("checked");
  }, [phase, dictation.listening]);

  async function finish(all: Answer[]) {
    setBusy(true);
    setError(null);
    try {
      onDone(await api<Sitting>("/student/speaking-drills", { body: { kind, items: all.map((a) => ({ sentenceId: a.sentence.id, heard: a.heard, spokenMs: a.spokenMs })) } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const next = () => {
    if (index + 1 >= sentences.length) return void finish(answers);
    setIndex(index + 1);
    setPlays(0);
    setPhase("ready");
    dictation.reset();
  };

  const showText = kind === "read" || phase === "checked";
  return (
    <div className="stack">
      <div className="spread">
        <div>
          <div className="small muted">{t(DRILL_KINDS[kind].label)}</div>
          <h1 ref={heading} tabIndex={-1} style={{ margin: 0 }}>
            {t("Sentence {n} of {total}", { n: index + 1, total: sentences.length })}
          </h1>
        </div>
        <button
          className="btn ghost small"
          onClick={() => {
            dictation.reset();
            stopSpeaking();
            onCancel();
          }}
        >
          {t("Cancel")}
        </button>
      </div>
      <Bar value={(index / sentences.length) * 100} label={t("Progress")} />
      <div className="card stack">
        {showText ? (
          <p style={{ fontSize: "1.25rem", lineHeight: 1.5, margin: 0 }}>{phase === "checked" && last ? <Words words={last.match.words} /> : sentence.text}</p>
        ) : (
          <div className="stack center" style={{ gap: 8 }}>
            <p className="muted" style={{ margin: 0 }}>
              {t(plays === 0 ? "Play the sentence, then say it back exactly." : "Say it back exactly as you heard it.")}
            </p>
            <button
              className={`btn ${plays === 0 ? "primary big" : ""}`}
              disabled={phase === "speaking" || plays >= 2}
              onClick={() => {
                speak(sentence.text);
                setPlays(plays + 1);
              }}
            >
              <Icon name="megaphone" /> {t(plays === 0 ? "Play the sentence" : "Play once more")}
            </button>
          </div>
        )}
        {phase === "speaking" && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="pill bad" role="status">
              {t(dictation.listening ? "Listening..." : "Starting the microphone...")}
            </span>
            <p className="small" style={{ margin: 0, minHeight: 24 }}>
              {dictation.text}
            </p>
          </div>
        )}
        {phase === "checked" && last && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="spread">
              <span className="small muted">
                {t("Heard:")} {last.heard || t("(nothing)")}
              </span>
              <span className={`pill ${tone(last.match.accuracy)}`} role="status">
                {last.match.accuracy}%
              </span>
            </div>
          </div>
        )}
        {dictation.error && <ErrorBox message={dictation.error} />}
      </div>
      {error && <ErrorBox message={error} />}
      {phase === "ready" && (
        <button className="btn primary big" disabled={kind === "repeat" && plays === 0} onClick={startSpeaking}>
          <Icon name="mic" /> {t(kind === "read" ? "Start reading" : "Start speaking")}
        </button>
      )}
      {phase === "speaking" && (
        <button className="btn danger big" onClick={stopAnswer}>
          {t("Done")}
        </button>
      )}
      {phase === "checked" && (
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={next}>
            {t(index + 1 >= sentences.length ? (busy ? "Saving..." : "See your score") : "Next sentence")}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              setAnswers((a) => a.slice(0, index));
              setPlays(0);
              setPhase("ready");
              dictation.reset();
            }}
          >
            {t("Try this one again")}
          </button>
        </div>
      )}
    </div>
  );
}

function DrillsPage() {
  const t = useT();
  const dates = useDates();
  const router = useRouter();
  const params = useSearchParams();
  const viewing = params.get("id");
  const home = useApi<Home>("/student/speaking-drills");
  const opened = useApi<Sitting>(viewing ? `/student/speaking-drills/${viewing}` : null);
  const [running, setRunning] = useState<DrillKind | null>(null);
  const [support, setSupport] = useState({ input: true, output: true });
  useEffect(() => setSupport({ input: speechInputSupported(), output: speechOutputSupported() }), []);

  if (viewing) {
    if (opened.error) return <ErrorBox message={opened.error.message} onRetry={opened.reload} />;
    if (!opened.data) return <Loading />;
    const kind = opened.data.kind;
    return (
      <Result
        sitting={opened.data}
        onAgain={() => {
          router.push("/play/speaking-drills");
          setRunning(kind);
        }}
        onBack={() => router.push("/play/speaking-drills")}
      />
    );
  }
  if (running)
    return (
      <Run
        kind={running}
        onCancel={() => setRunning(null)}
        onDone={(s) => {
          setRunning(null);
          void home.reload();
          router.push(`/play/speaking-drills?id=${s.id}`);
        }}
      />
    );
  if (home.error) return <ErrorBox message={home.error.message} onRetry={home.reload} />;
  if (!home.data) return <Loading />;
  // Set by a trainer: the kind of drill comes from the link.
  const start = params.get("start");
  const assigned = start === "read" || start === "repeat" ? start : null;

  return (
    <div className="stack">
      <div>
        <Link href="/play/me" className="small">
          <Icon name="back" size={16} /> {t("Me")}
        </Link>
        <h1 style={{ margin: "4px 0 0" }}>{t("Speaking drills")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Short drills like the automated English tests some companies use (Versant, SVAR). Each sentence is scored by how many of its words came through clearly.")}
        </p>
      </div>
      {assigned && (
        <div className="card spread" style={{ borderColor: "var(--accent)" }}>
          <div>
            <div className="small muted">{t("From your trainer")}</div>
            <b>{t(DRILL_KINDS[assigned].label)}</b>
          </div>
          <button className="btn primary small" disabled={!support.input || (assigned === "repeat" && !support.output)} onClick={() => setRunning(assigned)}>
            {t("Start")}
          </button>
        </div>
      )}
      {!support.input && <div className="card">{t("Speaking practice needs a browser that turns speech into text, such as Chrome on Android or on a computer.")}</div>}
      {home.data.kinds.map(({ kind, best, sittings }) => {
        const needsVoice = kind === "repeat" && !support.output;
        return (
          <div key={kind} className="card stack" style={{ gap: 6 }}>
            <div className="spread">
              <h2 style={{ margin: 0 }}>{t(DRILL_KINDS[kind].label)}</h2>
              {best !== null && <span className={`pill ${tone(best)}`}>{t("best {n}%", { n: best })}</span>}
            </div>
            <p className="small" style={{ margin: 0 }}>
              {t(DRILL_KINDS[kind].detail)}
            </p>
            {needsVoice && <p className="small muted" style={{ margin: 0 }}>{t("This browser can't read sentences aloud.")}</p>}
            <div className="spread">
              <span className="small muted">{t(sittings === 1 ? "1 sitting" : "{n} sittings", { n: sittings })}</span>
              <button className="btn primary" disabled={!support.input || needsVoice} onClick={() => setRunning(kind)}>
                {t("Start: 8 sentences")}
              </button>
            </div>
          </div>
        );
      })}
      <p className="muted small" style={{ margin: 0 }}>
        {t("Your browser turns your speech into text. PlayCode keeps the text and how long you spoke, never a recording.")}{" "}
        <Link href="/play/jam">{t("For a one-minute talk with feedback, try JAM.")}</Link>
      </p>
      {home.data.sittings.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t("Your sittings")}</h2>
          {home.data.sittings.map((s) => (
            <Link key={s.id} href={`/play/speaking-drills?id=${s.id}`} className="spread" style={{ color: "inherit" }}>
              <span>
                <b>{t(DRILL_KINDS[s.kind].label)}</b>
                <span className="small muted"> · {dates.ago(s.createdAt)}</span>
              </span>
              <span className={`pill ${tone(s.accuracy)}`}>{s.accuracy}%</span>
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
      <DrillsPage />
    </Suspense>
  );
}
