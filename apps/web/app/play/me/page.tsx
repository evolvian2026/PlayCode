"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DIVISION_LABELS } from "@playcode/core";
import { signOut, useMe } from "@/components/Auth";
import { DisplayCard } from "@/components/DisplayCard";
import { GuardianCard } from "@/components/GuardianCard";
import { Icon } from "@/components/Icon";
import { PrivacyCard } from "@/components/PrivacyCard";
import { PushCard } from "@/components/PushCard";
import { DevicesCard } from "@/components/SecurityPanel";
import { Bar, ErrorBox, Loading, masteryTone } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { LOCALES, storeLocale, useLocale, useT, type Locale } from "@/lib/i18n";
import type { StudentDetail } from "@/lib/types";

function Certificates() {
  const t = useT();
  const { data } = useApi<{ certificates: { code: string; title: string; scorePct: number; issuedAt: string; revokedAt: string | null }[] }>("/student/certificates");
  if (!data?.certificates.length) return null;
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("Certificates")}</h2>
      {data.certificates.map((c) => (
        <div key={c.code} className="spread">
          <div>
            <b>{c.title}</b>
            <div className="muted small">
              {c.scorePct}% · {new Date(c.issuedAt).toLocaleDateString()} · code {c.code}
            </div>
          </div>
          <Link href={`/verify/${c.code}`} className="btn small">
            {t("View")}
          </Link>
        </div>
      ))}
      <p className="muted small" style={{ margin: 0 }}>
        {t("Share the link with recruiters: it shows the certificate and proves it is genuine.")}
      </p>
    </div>
  );
}

function LanguageCard() {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  async function choose(next: Locale) {
    setBusy(true);
    await api("/student/settings", { method: "PUT", body: { locale: next } }).catch(() => {});
    storeLocale(next);
    window.location.reload();
  }
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("Language")} / Language</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t("Choose the language for menus and buttons. Questions and code stay in English, as in placement tests.")}
      </p>
      <div className="row">
        {LOCALES.map((l) => (
          <button key={l.id} className={`btn small ${l.id === locale ? "primary" : ""}`} disabled={busy || l.id === locale} onClick={() => choose(l.id)} lang={l.id}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WhatsAppSettings() {
  const t = useT();
  const [phone, setPhone] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void api<{ phone: string | null; whatsapp: boolean }>("/student/settings").then((r) => {
      setPhone(r.phone ?? "");
      setEnabled(r.whatsapp);
    });
  }, []);
  async function save(next: { phone?: string | null; whatsapp?: boolean }) {
    try {
      const r = await api<{ phone: string | null; whatsapp: boolean }>("/student/settings", { method: "PUT", body: next });
      setPhone(r.phone ?? "");
      setEnabled(r.whatsapp);
      setMsg(t("Saved"));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("Reminders")}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t("Streak, assignment and test reminders always appear in Messages. Add a number to get them on WhatsApp too.")}
      </p>
      <div className="row">
        <input aria-label="WhatsApp number" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="btn small" onClick={() => save({ phone: phone.trim() || null })}>
          {t("Save")}
        </button>
      </div>
      <label className="row" style={{ fontWeight: 500, gap: 8 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => save({ whatsapp: e.target.checked })} style={{ width: "auto" }} />
        {t("Send me WhatsApp reminders")}
      </label>
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}

export default function MePage() {
  const me = useMe();
  const tr = useT();
  const { data, error, loading, reload } = useApi<StudentDetail & { contest: { rating: number; contests: number } | null }>("/student/profile");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  const topics = new Map<string, { name: string; skills: StudentDetail["skills"] }>();
  for (const s of data.skills) {
    const t = topics.get(s.topic) ?? topics.set(s.topic, { name: s.topicName, skills: [] }).get(s.topic)!;
    t.skills.push(s);
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1 style={{ margin: 0 }}>{data.user.name}</h1>
          <div className="muted small">
            {data.user.rollNo ?? data.user.email} · {me.tenant?.name}
          </div>
        </div>
        <button className="btn small ghost" onClick={signOut} aria-label={tr("Sign out")}>
          <Icon name="logout" /> {tr("Sign out")}
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="card tight center">
          <div className="kpi">{data.level}</div>
          <div className="muted small">{data.title}</div>
        </div>
        <div className="card tight center">
          <div className="kpi stat-streak">{data.streak}</div>
          <div className="muted small">{tr("day streak (best {n})", { n: data.longestStreak })}</div>
        </div>
        <div className="card tight center">
          <div className="kpi">{data.correctAnswers}</div>
          <div className="muted small">{tr("correct answers")}</div>
        </div>
      </div>

      <Certificates />

      <Link href="/play/resume" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("My resume")}</b>
          <div className="small muted">{tr("A resume and public profile built from your verified PlayCode record")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/panel" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Mock interviews with people")}</b>
          <div className="small muted">{tr("Book a practice interview with a teacher or an alumnus")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/mentor" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("My mentor")}</b>
          <div className="small muted">{tr("Your faculty mentor and what you agreed to do")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/circulars" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Circulars")}</b>
          <div className="small muted">{tr("Notices from your placement cell and teachers.")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/calendar" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Calendar")}</b>
          <div className="small muted">{tr("Everything dated in one place, and a link for your phone's calendar")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/training" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Training sessions")}</b>
          <div className="small muted">{tr("Placement classes for your batch, and your attendance")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/class-tests" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Class tests")}</b>
          <div className="small muted">{tr("Marks from tests on paper, with every question and answer")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/writing" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Written English")}</b>
          <div className="small muted">{tr("Practise the email and essay tasks from placement tests, with feedback")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/gd" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Group discussion")}</b>
          <div className="small muted">{tr("Practise the GD round with AI participants and get a scorecard")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/doubts" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("My doubts")}</b>
          <div className="small muted">{tr("Questions you asked your teachers, and their answers")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/squad" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Study squad")}</b>
          <div className="small muted">{tr("Practise with classmates towards a weekly goal")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/offline" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Practise offline")}</b>
          <div className="small muted">{tr("Download questions to answer with no signal; they're checked when you're back online")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/mocks" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Mock tests")}</b>
          <div className="small muted">{tr("Full timed tests on the service and product company patterns")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/plan" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Study plan")}</b>
          <div className="small muted">{tr("A day-by-day plan to your next placement test")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <Link href="/play/talent" className="card spread" style={{ color: "inherit" }}>
        <div>
          <b>{tr("Get found by companies")}</b>
          <div className="small muted">{tr("Join the talent pool and see invitations from companies")}</div>
        </div>
        <Icon name="arrow" />
      </Link>

      <LanguageCard />

      <GuardianCard />
      <DisplayCard />

      <PushCard />

      <WhatsAppSettings />

      <PrivacyCard />

      <DevicesCard />

      {data.contest && (
        <Link href="/play/contests" className="card spread" style={{ color: "inherit" }}>
          <div>
            <div className="muted small">{tr("Contest rating")}</div>
            <span className="kpi">{data.contest.rating}</span>
            <div className="small muted">{tr("from {n} rated contests", { n: data.contest.contests })}</div>
          </div>
          <Icon name="trophy" />
        </Link>
      )}

      <div className="card stack">
        <h2>{tr("Placement readiness")}</h2>
        {data.readiness.map((r) => (
          <div key={r.id}>
            <div className="spread small">
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span>{r.score}/100</span>
            </div>
            <Bar value={r.score} tone={masteryTone(r.score)} />
          </div>
        ))}
        <p className="muted small" style={{ margin: 0 }}>
          {tr("Based on your mastery of the topics each kind of company tests. Skills you have not practised in a month count for less.")}
        </p>
      </div>

      <div className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>{tr("Badges")}</h2>
          <span className="muted small">{tr("{division} division", { division: DIVISION_LABELS[data.division] })}</span>
        </div>
        {data.badges.length === 0 ? (
          <p className="muted">{tr("Answer your first question to earn a badge.")}</p>
        ) : (
          <div className="row wrap">
            {data.badges.map((b) => (
              <span key={b.code} className="pill accent" title={b.description}>
                {b.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>{tr("Skills")}</h2>
          <span className="row small">
            <Link href="/play/tests">{tr("Tests")}</Link>
            <Link href="/play/mistakes">{tr("Mistake notebook ({n})", { n: data.openMistakes })}</Link>
          </span>
        </div>
        {[...topics.values()].map((t) => (
          <div key={t.name} className="stack" style={{ gap: 6 }}>
            <div className="muted small" style={{ fontWeight: 700 }}>
              {t.name}
            </div>
            {t.skills.map((s) => (
              <div key={s.skillId}>
                <div className="spread small">
                  <span>{s.name}</span>
                  <span className="muted">{s.attempts ? tr("{mastery}% · {acc}% right", { mastery: s.mastery, acc: s.accuracyPct ?? 0 }) : tr("not started")}</span>
                </div>
                <Bar value={s.mastery} tone={masteryTone(s.mastery)} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
