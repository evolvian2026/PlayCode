"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Speech for voice mock interviews, using the browser's own Web Speech API:
// recognition turns the student's answer into text (Chrome and Edge send the
// audio to their speech service; Safari may process it on the device), and
// synthesis reads the interviewer's questions aloud. PlayCode only receives the
// text and how long the student spoke; no audio reaches our servers.

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechInputSupported(): boolean {
  return recognitionCtor() !== null;
}

export function speechOutputSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type your answer.",
  "service-not-allowed": "Speech recognition is turned off in this browser. Type your answer instead.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs an internet connection. Type your answer, or try again.",
};

/**
 * Dictation into a text box. `text` is the transcript so far (final words plus
 * the words still being recognised); `spokenMs()` adds up the time the
 * microphone was on across every start and stop since the last reset,
 * including a recording still running (Send can be pressed before the
 * browser reports that recognition has ended).
 */
export function useDictation(lang = "en-IN") {
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const totalMs = useRef(0);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const startedAt = useRef<number | null>(null);

  const closeTimer = () => {
    if (startedAt.current !== null) {
      totalMs.current += Date.now() - startedAt.current;
      startedAt.current = null;
    }
  };

  const start = useCallback(
    (prefix = "") => {
      const Ctor = recognitionCtor();
      if (!Ctor || rec.current) return;
      setError(null);
      finalText.current = prefix ? `${prefix.trim()} ` : "";
      const r = new Ctor();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]!;
          if (res.isFinal) finalText.current += `${res[0].transcript.trim()} `;
          else interim += res[0].transcript;
        }
        setText(`${finalText.current}${interim}`.trimStart());
      };
      r.onerror = (e) => {
        if (e.error !== "no-speech" && e.error !== "aborted") setError(ERRORS[e.error] ?? "Speech recognition stopped. Try again, or type your answer.");
      };
      r.onend = () => {
        closeTimer();
        rec.current = null;
        setListening(false);
        setText(finalText.current.trim());
      };
      rec.current = r;
      startedAt.current = Date.now();
      setListening(true);
      r.start();
    },
    [lang],
  );

  const stop = useCallback(() => rec.current?.stop(), []);

  const reset = useCallback(() => {
    rec.current?.abort();
    rec.current = null;
    startedAt.current = null;
    finalText.current = "";
    setListening(false);
    setText("");
    totalMs.current = 0;
  }, []);

  const spokenMs = useCallback(() => totalMs.current + (startedAt.current !== null ? Date.now() - startedAt.current : 0), []);

  useEffect(() => () => rec.current?.abort(), []);

  return { listening, text, error, spokenMs, start, stop, reset };
}

/** Read text aloud in an Indian English voice where the device has one. */
export function speak(text: string, lang = "en-IN") {
  if (!speechOutputSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  // Code in backticks is read as words.
  const u = new SpeechSynthesisUtterance(text.replace(/`+/g, ""));
  u.lang = lang;
  const voice = synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.startsWith("en"));
  if (voice) u.voice = voice;
  u.rate = 1;
  synth.speak(u);
}

export function stopSpeaking() {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}
