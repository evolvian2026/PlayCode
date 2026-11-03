"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Bar, ErrorBox, Loading, masteryTone } from "@/components/ui";
import { ResumeEntries } from "@/components/ResumeEntries";
import { ResumeReview, type Check } from "@/components/ResumeReview";
import { api, errorMessage, fetchObjectUrl, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Profile {
  headline: string;
  about: string;
  links: { github?: string; linkedin?: string; portfolio?: string };
  hide: { readiness?: boolean; interview?: boolean; marks?: boolean };
  publicUrl: string | null;
}

interface Resume {
  name: string;
  institution: string;
  appName: string;
  program: string | null;
  academic: { cgpa: number | null; graduationYear: number | null } | null;
  readiness: { id: string; name: string; score: number }[];
  skills: { id: string; name: string; mastery: number }[];
  certificates: { title: string; code: string; scorePct: number; verifyUrl: string }[];
  practice: { questionsSolved: number; codingProblemsSolved: number; sqlProblemsSolved: number; activeDays90: number; longestStreak: number };
  mockInterview: { track: string; overall: number } | null;
  aptitude: { score: number; quant: number | null; reasoning: number | null; takenAt: string } | null;
}

export default function ResumePage() {
  const t = useT();
  const { data, error, loading, reload } = useApi<{ profile: Profile; resume: Resume; checks: Check[]; score: number }>("/student/resume");
  const [form, setForm] = useState<Profile | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data && !form) setForm(data.profile);
  }, [data, form]);

  if (loading && !data) return <Loading />;
  if (error || !data || !form) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const r = data.resume;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ profile: Profile }>("/student/resume", { method: "PUT", body: { headline: form!.headline, about: form!.about, links: form!.links, hide: form!.hide } });
      setForm(res.profile);
      setMsg(t("Saved"));
      // The checks look at what was just saved.
      void reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  async function setPublic(on: boolean) {
    setBusy(true);
    try {
      const res = await api<{ profile: Profile }>("/student/resume/public", { body: { public: on } });
      setForm({ ...form!, publicUrl: res.profile.publicUrl });
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const url = await fetchObjectUrl("/student/resume/pdf");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.name.replace(/[^\w]+/g, "-").toLowerCase()}-resume.pdf`;
    a.click();
  }

  const link = (key: keyof Profile["links"]) => (
    <input
      aria-label={key}
      placeholder={{ github: "https://github.com/you", linkedin: "https://linkedin.com/in/you", portfolio: "https://your-site.dev" }[key]}
      value={form.links[key] ?? ""}
      onChange={(e) => setForm({ ...form, links: { ...form.links, [key]: e.target.value } })}
    />
  );

  return (
    <div className="stack">
      <div className="spread">
        <h1 style={{ margin: 0 }}>{t("My resume")}</h1>
        <button className="btn primary small" onClick={download}>
          {t("Download PDF")}
        </button>
      </div>
      <ResumeReview checks={data.checks} score={data.score} onChange={() => void reload()} />
      <form className="card stack" onSubmit={save}>
        <h2 style={{ margin: 0 }}>{t("About you")}</h2>
        <input aria-label={t("Headline")} placeholder={t("e.g. Final-year CSE student who enjoys Java and SQL")} maxLength={120} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
        <textarea aria-label={t("About")} rows={3} maxLength={800} placeholder={t("Two or three lines about what you have built and what you want to do.")} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} />
        {link("linkedin")}
        {link("github")}
        {link("portfolio")}
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">{t("Show on my resume and public profile:")}</span>
          {(
            [
              ["readiness", "Readiness scores"],
              ["interview", "Mock interview score"],
              ["marks", "CGPA and class 10/12 marks (resume PDF only)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="row small" style={{ gap: 8, fontWeight: 500 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={!form.hide[key]} onChange={(e) => setForm({ ...form, hide: { ...form.hide, [key]: !e.target.checked } })} />
              {t(label)}
            </label>
          ))}
        </div>
        {err && <ErrorBox message={err} />}
        <div className="row">
          <button className="btn small" disabled={busy}>
            {t("Save")}
          </button>
          {msg && <span className="small muted">{msg}</span>}
        </div>
      </form>

      <ResumeEntries onChange={() => void reload()} />

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t("Verified by {app}", { app: r.appName })}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {t("These come from your practice and can't be edited. Practise more to improve them.")}
        </p>
        {r.readiness.map((x) => (
          <div key={x.id}>
            <div className="spread small">
              <span>{t(x.name)}</span>
              <b>{x.score}/100</b>
            </div>
            <Bar value={x.score} tone={masteryTone(x.score)} />
          </div>
        ))}
        <div className="small">
          {t("{q} questions, {c} coding and {s} SQL problems solved · {d} practice days in 90", { q: r.practice.questionsSolved, c: r.practice.codingProblemsSolved, s: r.practice.sqlProblemsSolved, d: r.practice.activeDays90 })}
        </div>
        {r.mockInterview && <div className="small">{t("Mock interview: {n}/5", { n: r.mockInterview.overall })}</div>}
        {r.aptitude && <div className="small">{t("Aptitude score: {n} of 900, from an official sitting", { n: r.aptitude.score })}</div>}
        <div className="row wrap">
          {r.skills.length === 0 ? (
            <span className="small muted">{t("Skills appear here once you reach 60% mastery with at least 5 answers.")}</span>
          ) : (
            r.skills.map((s) => (
              <span key={s.id} className="pill accent">
                {s.name} {s.mastery}%
              </span>
            ))
          )}
        </div>
        {r.certificates.length > 0 && <div className="small">{t("{n} verified certificates", { n: r.certificates.length })}</div>}
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t("Public profile")}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {t("A link you can put on your resume or send to recruiters. It shows your name, college, verified skills and certificates, but not your email, phone, roll number or marks.")}
        </p>
        {form.publicUrl ? (
          <>
            <div className="row wrap">
              <code className="inline-code" style={{ wordBreak: "break-all" }}>{form.publicUrl}</code>
              <button className="btn small" type="button" onClick={() => void navigator.clipboard.writeText(form.publicUrl!).then(() => setMsg(t("Link copied")))}>
                {t("Copy link")}
              </button>
            </div>
            <button className="btn ghost small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => setPublic(false)}>
              {t("Make private")}
            </button>
          </>
        ) : (
          <button className="btn primary small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => setPublic(true)}>
            {t("Create public link")}
          </button>
        )}
      </div>
    </div>
  );
}
