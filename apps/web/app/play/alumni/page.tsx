"use client";

import Link from "next/link";
import { useState } from "react";
import { MAX_PENDING_INTROS, type IntroPurpose } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Alumnus {
  id: string;
  name: string;
  graduationYear: number;
  department: string;
  company: string;
  role: string;
  city: string;
  openToReferrals: boolean;
  openToAdvice: boolean;
}
interface Intro {
  id: string;
  alumnusId: string;
  alumnus: string;
  company: string;
  purposeLabel: string;
  status: "pending" | "sent" | "declined";
  declineNote: string | null;
}
interface Data {
  alumni: Alumnus[];
  intros: Intro[];
}

const STATUS: Record<Intro["status"], [string, string]> = { pending: ["With the placement cell", "accent"], sent: ["Introduction sent", "good"], declined: ["Not sent", ""] };

function Ask({ a, onDone, onCancel }: { a: Alumnus; onDone: (d: Data) => void; onCancel: () => void }) {
  const t = useT();
  const [purpose, setPurpose] = useState<IntroPurpose>(a.openToAdvice ? "advice" : "referral");
  const [message, setMessage] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function send() {
    setMsg(null);
    try {
      onDone(await api<Data>("/student/alumni/intros", { body: { alumnusId: a.id, purpose, message } }));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
      <div role="radiogroup" aria-label={t("What would you like?")} className="row wrap" style={{ gap: 10 }}>
        {a.openToAdvice && (
          <label className="row small" style={{ gap: 4 }}>
            <input type="radio" name={`p-${a.id}`} style={{ width: "auto" }} checked={purpose === "advice"} onChange={() => setPurpose("advice")} />
            {t("Advice")}
          </label>
        )}
        {a.openToReferrals && (
          <label className="row small" style={{ gap: 4 }}>
            <input type="radio" name={`p-${a.id}`} style={{ width: "auto" }} checked={purpose === "referral"} onChange={() => setPurpose("referral")} />
            {t("A referral")}
          </label>
        )}
      </div>
      <label htmlFor={`m-${a.id}`} className="small">
        {t("A short note to {name}: who you are and what you'd like to ask", { name: a.name })}
      </label>
      <textarea className="prose" id={`m-${a.id}`} rows={4} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
      <div className="small muted">{t("The placement cell reads it first, then sends it with your resume.")}</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary small" disabled={message.trim().length < 40} onClick={send}>
          {t("Send to the placement cell")}
        </button>
        <button className="btn ghost small" onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

export default function AlumniPage() {
  const t = useT();
  const { data, error, loading, reload, setData } = useApi<Data>("/student/alumni");
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const needle = q.trim().toLowerCase();
  const list = data.alumni.filter((a) => !needle || `${a.name} ${a.company} ${a.role} ${a.department}`.toLowerCase().includes(needle));
  const asked = new Map(data.intros.filter((i) => i.status !== "declined").map((i) => [i.alumnusId, i]));
  const pending = data.intros.filter((i) => i.status === "pending").length;
  async function withdraw(id: string) {
    setMsg(null);
    try {
      setData(await api<Data>(`/student/alumni/intros/${id}`, { method: "DELETE" }));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="stack">
      <div>
        <Link href="/play/placements" className="small muted">
          ← {t("Placements")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{t("Alumni")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Seniors who are happy to help. Ask for advice about a company, or a referral; your placement cell sends the introduction.")}
        </p>
      </div>
      {data.intros.length > 0 && (
        <section className="card stack" aria-labelledby="h-mine" style={{ gap: 8 }}>
          <h2 id="h-mine" style={{ margin: 0, fontSize: "1.05rem" }}>
            {t("Your requests")}
          </h2>
          {data.intros.map((i) => (
            <div key={i.id} className="stack" style={{ gap: 2 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <b>{i.alumnus}</b>
                <span className="small muted">
                  {i.company} · {t(i.purposeLabel)}
                </span>
                <span className={`pill ${STATUS[i.status][1]}`}>{t(STATUS[i.status][0])}</span>
                {i.status === "pending" && (
                  <button className="btn ghost small" onClick={() => withdraw(i.id)}>
                    {t("Withdraw")}
                  </button>
                )}
              </div>
              {i.status === "sent" && <div className="small muted">{t("If they can help, they'll write to you by email.")}</div>}
              {i.declineNote && <div className="small muted">{i.declineNote}</div>}
            </div>
          ))}
          {msg && <ErrorBox message={msg} />}
        </section>
      )}
      <div>
        <label htmlFor="al-find">{t("Find by company or name")}</label>
        <input id="al-find" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      {list.length === 0 && <div className="card muted">{t("No one matches.")}</div>}
      {list.map((a) => {
        const mine = asked.get(a.id);
        return (
          <div key={a.id} className="card stack" style={{ gap: 6 }}>
            <div className="spread" style={{ alignItems: "flex-start", gap: 8 }}>
              <div>
                <b>{a.name}</b>
                <div className="small">
                  {a.role ? `${a.role}, ` : ""}
                  {a.company}
                </div>
                <div className="small muted">
                  {[a.department, t("batch of {year}", { year: a.graduationYear }), a.city].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="row wrap" style={{ gap: 4, justifyContent: "flex-end" }}>
                {a.openToAdvice && <span className="pill">{t("Advice")}</span>}
                {a.openToReferrals && <span className="pill accent">{t("Referrals")}</span>}
              </div>
            </div>
            {mine ? (
              <span className={`pill ${STATUS[mine.status][1]}`} style={{ alignSelf: "flex-start" }}>
                {t(STATUS[mine.status][0])}
              </span>
            ) : asking === a.id ? (
              <Ask
                a={a}
                onCancel={() => setAsking(null)}
                onDone={(d) => {
                  setData(d);
                  setAsking(null);
                }}
              />
            ) : (
              <button className="btn small" style={{ alignSelf: "flex-start" }} disabled={pending >= MAX_PENDING_INTROS} onClick={() => setAsking(a.id)}>
                {t("Ask for an introduction")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
