"use client";

import Link from "next/link";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface OnQuestion {
  mine: { id: string; text: string; status: "open" | "answered" | "closed"; answer: string | null }[];
  shared: { id: string; text: string; answer: string }[];
}

/** After answering: what classmates asked about this question, and a way to ask your teachers. */
export function AskDoubt({ questionId }: { questionId: string }) {
  const t = useT();
  const [data, setData] = useState<OnQuestion | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function expand() {
    setOpen(true);
    try {
      setData(await api<OnQuestion>(`/student/questions/${encodeURIComponent(questionId)}/doubts`));
    } catch {
      setData({ mine: [], shared: [] });
    }
  }

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/student/questions/${encodeURIComponent(questionId)}/doubts`, { body: { text } });
      setText("");
      setMsg(t("Sent to your teachers. You'll get a notification when they answer."));
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start", padding: "2px 0" }} onClick={expand}>
        {t("Still confused? Ask your teachers")}
      </button>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {data && data.shared.length > 0 && (
        <div className="stack small" style={{ gap: 6 }}>
          <b>{t("Classmates asked")}</b>
          {data.shared.map((d) => (
            <div key={d.id}>
              <div className="muted">{d.text}</div>
              <div>{d.answer}</div>
            </div>
          ))}
        </div>
      )}
      {data?.mine.map((d) => (
        <div key={d.id} className="small">
          <div className="muted">
            {t("You asked:")} {d.text}
          </div>
          <div>{d.answer ?? t(d.status === "closed" ? "Closed by your teacher." : "Waiting for an answer.")}</div>
        </div>
      ))}
      <textarea aria-label={t("Your doubt")} rows={2} maxLength={1000} placeholder={t("What don't you understand? Say which step.")} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row wrap">
        <button type="button" className="btn small" disabled={busy || text.trim().length < 5} onClick={send}>
          {t("Ask")}
        </button>
        <Link href="/play/doubts" className="small">
          {t("My doubts")}
        </Link>
      </div>
      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
