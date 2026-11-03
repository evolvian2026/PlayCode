"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";

const REASONS = [
  ["wrong_answer", "The answer marked correct is wrong"],
  ["unclear", "The question is unclear"],
  ["typo", "There's a typo or formatting problem"],
  ["other", "Something else"],
] as const;

/** "Something wrong with this question?": goes to the content team's review queue. */
export function ReportQuestion({ questionId }: { questionId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("wrong_answer");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await api(`/student/questions/${encodeURIComponent(questionId)}/report`, { body: { reason, note } });
      setDone(t("Thanks. The content team will check this question."));
    } catch (e) {
      setDone(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <div className="small muted">{done}</div>;
  if (!open) {
    return (
      <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start", padding: "2px 0" }} onClick={() => setOpen(true)}>
        {t("Something wrong with this question?")}
      </button>
    );
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <select aria-label={t("What's wrong?")} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
        {REASONS.map(([id, label]) => (
          <option key={id} value={id}>
            {t(label)}
          </option>
        ))}
      </select>
      <textarea aria-label={t("Details (optional)")} rows={2} maxLength={1000} placeholder={t("Details (optional)")} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <button type="button" className="btn small" disabled={busy} onClick={send}>
          {t("Send report")}
        </button>
        <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
