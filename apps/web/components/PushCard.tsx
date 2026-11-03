"use client";

import { useEffect, useState } from "react";
import { ErrorBox } from "@/components/ui";
import { errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { currentSubscription, disablePush, enablePush, pushSupported } from "@/lib/push";

/** Turn phone notifications on or off for this device. */
export function PushCard() {
  const t = useT();
  const { data } = useApi<{ available: boolean; publicKey: string | null; devices: number }>("/push");
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void currentSubscription().then((s) => setOn(Boolean(s)));
  }, []);
  if (!data?.available) return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else {
        const problem = await enablePush(data!.publicKey!);
        if (problem) setError(t(problem));
        else setOn(true);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("Notifications on this phone")}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t("Get streak, assignment, test and placement reminders as phone notifications. Free, and you can turn them off any time.")}
      </p>
      {!pushSupported() ? (
        <div className="small muted">{t("This browser can't show notifications. On iPhone, add PlayCode to your home screen first, then open it from there.")}</div>
      ) : (
        <button className={`btn small ${on ? "" : "primary"}`} style={{ alignSelf: "flex-start" }} disabled={busy || on === null} onClick={toggle}>
          {on ? t("Turn off on this phone") : t("Turn on notifications")}
        </button>
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}
