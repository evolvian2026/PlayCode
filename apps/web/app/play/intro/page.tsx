"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { INTRO_PARTS, INTRO_SECONDS, introSeconds, matchDrill, wordCount, type IntroPractice } from "@playcode/core";
import { Icon } from "@/components/Icon";
import { MatchedWords } from "@/components/MatchedWords";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { speechInputSupported, useDictation } from "@/lib/speech";

interface Practice {
  runs: number;
  best: number | null;
  last: { coverage: number; seconds: number; wpm: number; fillersPer100Words: number; hidden: boolean; at: string } | null;
}

interface Data {
  intro: { targetRole: string; extra: string; script: string; seconds: number; draftedAt: string | null; practice: Practice; updatedAt: string | null };
  draft: { available: boolean; reason: string | null; leftToday: number };
  profile: { projects: number; internships: number; certifications: number; skills: number };
}

const LENGTH = { short: "Short", good: "About right", long: "Long" } as const;

/** Speak the script; the score is how much of it came through, and the delivery. */
function Practise({ script, onDone }: { script: string; onDone: (p: Practice) => void }) {
  const t = useT();
  const dictation = useDictation();
  const [hidden, setHidden] = useState(false);
  const [phase, setPhase] = useState<"ready" | "speaking" | "checking" | "done">("ready");
  const [spokenMs, setSpokenMs] = useState(0);
  const [result, setResult] = useState<{ practice: IntroPractice; heard: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(speechInputSupported()), []);

  const stop = () => {
    setSpokenMs(dictation.spokenMs());
    dictation.stop();
    setPhase("checking");
  };
  // Score once the last words are in.
  useEffect(() => {
    if (phase !== "checking" || dictation.listening) return;
    const heard = dictation.text.trim();
    void api<{ result: IntroPractice; practice: Practice }>("/student/intro/practice", { body: { heard, spokenMs: Math.max(1000, spokenMs), hidden } })
      .then((r) => {
        setResult({ practice: r.result, heard });
        onDone(r.practice);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setPhase("done"));
  }, [phase, dictation.listening]);

  if (!supported) return <div className="card">{t("Speaking practice needs a browser that turns speech into text, such as Chrome on Android or on a computer.")}</div>;
  const seconds = phase === "speaking" ? Math.round(dictation.spokenMs() / 1000) : 0;
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("Say it out loud")}</h2>
      <label className="row small" style={{ gap: 8 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={hidden} disabled={phase === "speaking"} onChange={(e) => setHidden(e.target.checked)} />
        {t("Hide the script while I speak, as in a real interview")}
      </label>
      {phase === "speaking" && !hidden && (
        <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap", background: "var(--surface-2, var(--accent-soft))", padding: 10, borderRadius: 8 }}>
          {script}
        </p>
      )}
      {phase === "speaking" && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="spread">
            <span className="pill bad" role="status">
              {t(dictation.listening ? "Listening..." : "Starting the microphone...")}
            </span>
            <span className="kpi" style={{ fontSize: "1.4rem" }} aria-live="off">
              0:{String(seconds).padStart(2, "0")}
            </span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {dictation.text}
          </p>
        </div>
      )}
      {dictation.error && <ErrorBox message={dictation.error} />}
      {error && <ErrorBox message={error} />}
      {phase === "speaking" ? (
        <button className="btn danger big" onClick={stop}>
          {t("Done")}
        </button>
      ) : (
        <button
          className="btn primary big"
          disabled={phase === "checking"}
          onClick={() => {
            setResult(null);
            setError(null);
            dictation.reset();
            dictation.start();
            setPhase("speaking");
          }}
        >
          <Icon name="mic" /> {t(result ? "Try again" : "Start speaking")}
        </button>
      )}
      {result && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <div className="center">
              <div className="kpi">{result.practice.coverage}%</div>
              <div className="small muted">{t("of your script came through")}</div>
            </div>
            <div className="center">
              <div className="kpi">{result.practice.seconds}s</div>
              <div className="small muted">{t(LENGTH[result.practice.length])}</div>
            </div>
            <div className="center">
              <div className="kpi">{result.practice.wpm}</div>
              <div className="small muted">{t("words a minute")}</div>
            </div>
          </div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {result.practice.tips.map((tip) => (
              <li key={tip}>{t(tip)}</li>
            ))}
          </ul>
          <details>
            <summary className="small" style={{ fontWeight: 600 }}>
              {t("Your script, with what wasn't heard struck through")}
            </summary>
            <p className="small" style={{ margin: "6px 0 0" }}>
              <MatchedWords words={matchDrill(script, result.heard).words} />
            </p>
          </details>
        </div>
      )}
    </div>
  );
}

export default function IntroPage() {
  const t = useT();
  const { data, error, reload, setData } = useApi<Data>("/student/intro");
  const [form, setForm] = useState<{ targetRole: string; extra: string; script: string } | null>(null);
  const [used, setUsed] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"draft" | "save" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (data && !form) setForm({ targetRole: data.intro.targetRole, extra: data.intro.extra, script: data.intro.script });
  }, [data]);

  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data || !form) return <Loading />;
  const dirty = form.script !== data.intro.script || form.targetRole !== data.intro.targetRole || form.extra !== data.intro.extra;
  const thin = data.profile.projects + data.profile.internships === 0;

  async function run(kind: "draft" | "save") {
    setBusy(kind);
    setMsg(null);
    setActionError(null);
    try {
      const r =
        kind === "draft"
          ? await api<Data & { used: string[] }>("/student/intro/draft", { body: { targetRole: form!.targetRole, extra: form!.extra } })
          : await api<Data>("/student/intro", { method: "PUT", body: form });
      setData(r);
      setForm({ targetRole: r.intro.targetRole, extra: r.intro.extra, script: r.intro.script });
      setUsed("used" in r ? (r as { used: string[] }).used : null);
      setMsg(t(kind === "draft" ? "Drafted from your profile. Make it sound like you, then save." : "Saved"));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const words = wordCount(form.script);
  const secs = introSeconds(form.script);
  return (
    <div className="stack">
      <div>
        <Link href="/play/me" className="small">
          <Icon name="back" size={16} /> {t("Me")}
        </Link>
        <h1 style={{ margin: "4px 0 0" }}>{t("Tell me about yourself")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Almost every interview starts here. Keep a one-minute introduction ready, and practise saying it until it sounds natural.")}
        </p>
      </div>
      <div className="card stack" style={{ gap: 6 }}>
        <b className="small">{t("A good introduction has three parts")}</b>
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {INTRO_PARTS.map(([key, title, detail]) => (
            <li key={key}>
              <b>{t(title)}</b>: {t(detail)}
            </li>
          ))}
        </ol>
      </div>
      <div className="card stack">
        <div>
          <label htmlFor="intro-role">{t("The role you're aiming for")}</label>
          <input id="intro-role" value={form.targetRole} maxLength={80} placeholder={t("For example: software engineer, data analyst")} onChange={(e) => setForm({ ...form, targetRole: e.target.value })} />
        </div>
        <div>
          <label htmlFor="intro-extra">{t("Anything else to mention (optional)")}</label>
          <input id="intro-extra" value={form.extra} maxLength={600} placeholder={t("A hobby, a result you're proud of, why this role")} onChange={(e) => setForm({ ...form, extra: e.target.value })} />
        </div>
        {data.draft.available ? (
          <div className="stack" style={{ gap: 4 }}>
            <button className="btn" disabled={busy !== null || data.draft.leftToday === 0} onClick={() => run("draft")}>
              <Icon name="spark" /> {t(busy === "draft" ? "Drafting..." : form.script ? "Draft again from my profile" : "Draft it from my profile")}
            </button>
            <span className="small muted">
              {thin
                ? t("Your profile has no projects or internships yet, so a draft will be short. Add them on your resume first.")
                : t("Uses your projects, internships, certifications and skills from PlayCode, nothing else.")}{" "}
              {t(data.draft.leftToday === 1 ? "1 draft left today." : "{n} drafts left today.", { n: data.draft.leftToday })}
            </span>
          </div>
        ) : (
          data.draft.reason && <span className="small muted">{t(data.draft.reason)}</span>
        )}
        <div>
          <label htmlFor="intro-script">{t("Your introduction")}</label>
          <textarea id="intro-script" rows={9} value={form.script} maxLength={3000} placeholder={t("Write it the way you would say it.")} onChange={(e) => setForm({ ...form, script: e.target.value })} />
          <div className={`small ${secs > INTRO_SECONDS.max + 10 ? "" : "muted"}`} style={{ color: secs > INTRO_SECONDS.max + 10 ? "var(--bad-ink)" : undefined }}>
            {t("{words} words, about {seconds} seconds to say. Aim for {min} to {max}.", { words, seconds: secs, min: INTRO_SECONDS.min, max: INTRO_SECONDS.max })}
          </div>
        </div>
        {used && used.length > 0 && (
          <div className="small">
            <b>{t("Check these are right:")}</b> {used.join(" · ")}
          </div>
        )}
        {actionError && <ErrorBox message={actionError} />}
        <div className="row">
          <button className="btn primary" disabled={busy !== null || !dirty || !form.script.trim()} onClick={() => run("save")}>
            {t(busy === "save" ? "Saving..." : "Save")}
          </button>
          {msg && (
            <span className="small muted" role="status">
              {msg}
            </span>
          )}
        </div>
      </div>
      {data.intro.script && !dirty && (
        <>
          <Practise script={data.intro.script} onDone={(practice) => setData({ ...data, intro: { ...data.intro, practice } })} />
          {data.intro.practice.runs > 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              {t(data.intro.practice.runs === 1 ? "1 run-through so far, best {best}%." : "{n} run-throughs so far, best {best}%.", { n: data.intro.practice.runs, best: data.intro.practice.best ?? 0 })}{" "}
              {t("Only these numbers are kept, not what you said.")}
            </p>
          )}
        </>
      )}
      {data.intro.script && dirty && <p className="small muted">{t("Save your changes to practise the new version.")}</p>}
    </div>
  );
}
