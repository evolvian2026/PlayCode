"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorBox } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function JoinLive() {
  const t = useT();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/student/live/join", { body: { code } });
      router.push(`/play/live/${id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={join} style={{ maxWidth: 360, margin: "40px auto 0", textAlign: "center" }}>
      <h1 style={{ margin: 0 }}>{t("Join a live quiz")}</h1>
      <label htmlFor="live-code">{t("Code on your teacher's screen")}</label>
      <input
        id="live-code"
        inputMode="numeric"
        autoComplete="off"
        pattern="\d{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        style={{ fontSize: "2rem", textAlign: "center", letterSpacing: "0.3em" }}
        required
      />
      {error && <ErrorBox message={error} />}
      <button className="btn primary big" disabled={busy || code.length !== 6}>
        {busy ? t("Joining...") : t("Join")}
      </button>
    </form>
  );
}
