"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DIVISION_LABELS } from "@playcode/core";
import { signOut, useMe } from "@/components/Auth";
import { Icon } from "@/components/Icon";
import { PrivacyCard } from "@/components/PrivacyCard";
import { Bar, ErrorBox, Loading, masteryTone } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";

function Certificates() {
  const { data } = useApi<{ certificates: { code: string; title: string; scorePct: number; issuedAt: string; revokedAt: string | null }[] }>("/student/certificates");
  if (!data?.certificates.length) return null;
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Certificates</h2>
      {data.certificates.map((c) => (
        <div key={c.code} className="spread">
          <div>
            <b>{c.title}</b>
            <div className="muted small">
              {c.scorePct}% · {new Date(c.issuedAt).toLocaleDateString()} · code {c.code}
            </div>
          </div>
          <Link href={`/verify/${c.code}`} className="btn small">
            View
          </Link>
        </div>
      ))}
      <p className="muted small" style={{ margin: 0 }}>
        Share the link with recruiters: it shows the certificate and proves it is genuine.
      </p>
    </div>
  );
}

function WhatsAppSettings() {
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
      setMsg("Saved");
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Reminders</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Streak, assignment and test reminders always appear in Messages. Add a number to get them on WhatsApp too.
      </p>
      <div className="row">
        <input aria-label="WhatsApp number" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="btn small" onClick={() => save({ phone: phone.trim() || null })}>
          Save
        </button>
      </div>
      <label className="row" style={{ fontWeight: 500, gap: 8 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => save({ whatsapp: e.target.checked })} style={{ width: "auto" }} />
        Send me WhatsApp reminders
      </label>
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}
import type { StudentDetail } from "@/lib/types";

export default function MePage() {
  const me = useMe();
  const { data, error, loading, reload } = useApi<StudentDetail>("/student/profile");
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
        <button className="btn small ghost" onClick={signOut} aria-label="Sign out">
          <Icon name="logout" /> Sign out
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="card tight center">
          <div className="kpi">{data.level}</div>
          <div className="muted small">{data.title}</div>
        </div>
        <div className="card tight center">
          <div className="kpi stat-streak">{data.streak}</div>
          <div className="muted small">day streak (best {data.longestStreak})</div>
        </div>
        <div className="card tight center">
          <div className="kpi">{data.correctAnswers}</div>
          <div className="muted small">correct answers</div>
        </div>
      </div>

      <Certificates />

      <WhatsAppSettings />

      <PrivacyCard />

      <div className="card stack">
        <h2>Placement readiness</h2>
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
          Based on your mastery of the topics each kind of company tests. Skills you have not practised in a month count for less.
        </p>
      </div>

      <div className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Badges</h2>
          <span className="muted small">{DIVISION_LABELS[data.division]} division</span>
        </div>
        {data.badges.length === 0 ? (
          <p className="muted">Answer your first question to earn a badge.</p>
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
          <h2 style={{ margin: 0 }}>Skills</h2>
          <span className="row small">
            <Link href="/play/tests">Tests</Link>
            <Link href="/play/mistakes">Mistake notebook ({data.openMistakes})</Link>
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
                  <span className="muted">{s.attempts ? `${s.mastery}% · ${s.accuracyPct}% right` : "not started"}</span>
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
