"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { HELP_CATEGORIES, RECORD_FIELDS, type HelpCategory, type RecordField } from "@playcode/core";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

type Status = "open" | "answered" | "closed";
interface Thread {
  id: string;
  categoryLabel: string;
  subject: string;
  status: Status;
  correction: { field: RecordField; label: string; current: number | null; proposed: number; status: "pending" | "applied" | "declined" } | null;
  messages: { id: string; fromStaff: boolean; body: string; createdAt: string; author: string | null }[];
}

const STATUS: Record<Status, [string, string]> = { open: ["Waiting for the placement cell", "warn"], answered: ["Answered", "good"], closed: ["Closed", ""] };

function NewQuestion({ category: initial, onDone }: { category: HelpCategory; onDone: (id: string) => void }) {
  const t = useT();
  const [category, setCategory] = useState<HelpCategory>(initial);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [field, setField] = useState<RecordField | "">("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const correction = category === "record" && field && value !== "" ? { field, proposed: Number(value) } : null;
      onDone((await api<Thread>("/student/help", { body: { category, subject, message, correction } })).id);
    } catch (err) {
      setMsg(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t("Ask the placement cell")}</h2>
      <div>
        <label htmlFor="h-cat">{t("What is it about?")}</label>
        <select id="h-cat" value={category} onChange={(e) => setCategory(e.target.value as HelpCategory)}>
          {(Object.keys(HELP_CATEGORIES) as HelpCategory[]).map((c) => (
            <option key={c} value={c}>
              {t(HELP_CATEGORIES[c])}
            </option>
          ))}
        </select>
      </div>
      {category === "record" && (
        <div className="row wrap">
          <div>
            <label htmlFor="h-field">{t("What's wrong")}</label>
            <select id="h-field" value={field} onChange={(e) => setField(e.target.value as RecordField)}>
              <option value="">{t("Choose")}</option>
              {(Object.keys(RECORD_FIELDS) as RecordField[]).map((f) => (
                <option key={f} value={f}>
                  {t(RECORD_FIELDS[f].label)}
                </option>
              ))}
            </select>
          </div>
          {field && (
            <div>
              <label htmlFor="h-value">{t("The right value")}</label>
              <input id="h-value" type="number" inputMode="decimal" step={RECORD_FIELDS[field].integer ? 1 : 0.01} min={RECORD_FIELDS[field].min} max={RECORD_FIELDS[field].max} value={value} onChange={(e) => setValue(e.target.value)} required style={{ maxWidth: 140 }} />
            </div>
          )}
        </div>
      )}
      <div>
        <label htmlFor="h-subject">{t("Subject")}</label>
        <input id="h-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} required />
      </div>
      <div>
        <label htmlFor="h-msg">{t("Your message")}</label>
        <textarea id="h-msg" className="prose" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={3000} required placeholder={category === "record" ? t("e.g. My semester 6 result shows CGPA 8.4. I've uploaded the marksheet under Documents.") : undefined} />
      </div>
      {msg && <ErrorBox message={msg} />}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy}>
        {busy ? t("Sending...") : t("Send")}
      </button>
    </form>
  );
}

function ThreadView({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading, reload, setData } = useApi<Thread>(`/student/help/${id}`);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  const fmt = (d: string) => new Date(d).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  async function call(path: "reply" | "close") {
    setBusy(true);
    setMsg(null);
    try {
      setData(await api<Thread>(`/student/help/${id}/${path}`, { body: path === "reply" ? { body: reply } : {} }));
      setReply("");
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const [label, tone] = STATUS[data.status];
  return (
    <div className="stack">
      <div>
        <Link href="/play/help" className="small muted">
          ← {t("Your questions")}
        </Link>
        <h1 style={{ margin: "6px 0 0" }}>{data.subject}</h1>
        <div className="row wrap small" style={{ gap: 8 }}>
          <span className="muted">{t(data.categoryLabel)}</span>
          <span className={`pill ${tone}`}>{t(label)}</span>
        </div>
      </div>
      {data.correction && (
        <div className="card tight small">
          {t("Correction asked for: {field} from {from} to {to}", { field: t(data.correction.label), from: data.correction.current ?? "-", to: data.correction.proposed })}
          {" · "}
          <b>{t(data.correction.status === "applied" ? "Applied" : data.correction.status === "declined" ? "Not changed" : "Being checked")}</b>
        </div>
      )}
      {data.messages.map((m) => (
        <div key={m.id} className="card stack" style={{ gap: 4, marginLeft: m.fromStaff ? 0 : 24, borderColor: m.fromStaff ? "var(--accent)" : undefined }}>
          <div className="small muted">
            {m.fromStaff ? m.author : t("You")} · {fmt(m.createdAt)}
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
        </div>
      ))}
      {data.status !== "closed" && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void call("reply");
          }}
        >
          <label htmlFor="h-reply" className="sr-only">
            {t("Reply")}
          </label>
          <textarea id="h-reply" className="prose" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={3000} placeholder={t("Reply")} />
          <div className="row">
            <button className="btn primary small" disabled={busy || reply.trim().length < 2}>
              {t("Send")}
            </button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => call("close")}>
              {t("It's sorted, close it")}
            </button>
          </div>
        </form>
      )}
      {msg && <ErrorBox message={msg} />}
    </div>
  );
}

function Help() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const fresh = params.get("new");
  const { data, error, loading, reload } = useApi<{ tickets: { id: string; categoryLabel: string; subject: string; status: Status; updatedAt: string }[] }>(id ? null : "/student/help");
  const [asking, setAsking] = useState(Boolean(fresh));
  if (id) return <ThreadView key={id} id={id} />;
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? t("Could not load")} onRetry={reload} />;
  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: 0 }}>{t("Ask the placement cell")}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t("Questions about your record, a drive or your documents. You'll get a notification when they answer.")}
        </p>
      </div>
      {asking ? (
        <NewQuestion category={(fresh && fresh in HELP_CATEGORIES ? fresh : "other") as HelpCategory} onDone={(tid) => router.replace(`/play/help?id=${tid}`)} />
      ) : (
        <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => setAsking(true)}>
          {t("Ask a question")}
        </button>
      )}
      {data.tickets.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t("Your questions")}</h2>
          {data.tickets.map((q) => {
            const [label, tone] = STATUS[q.status];
            return (
              <Link key={q.id} href={`/play/help?id=${q.id}`} className="spread wrap" style={{ color: "inherit", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div>
                  <b>{q.subject}</b>
                  <div className="small muted">{t(q.categoryLabel)}</div>
                </div>
                <span className={`pill ${tone}`}>{t(label)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Help />
    </Suspense>
  );
}
