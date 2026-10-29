"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";

interface Link {
  student: string;
  institution: string;
  name: string;
  status: "waiting" | "active" | "stopped";
}

/** Opened from the email a parent receives: confirm the monthly progress email, or stop it. No sign-in. */
export default function GuardianLink() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Link | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<Link>(`/public/guardian/${encodeURIComponent(token)}`)
      .then(setData)
      .catch(() => setData(null));
  }, [token]);

  async function act(path: "confirm" | "stop") {
    setBusy(true);
    setMsg(null);
    try {
      setData(await api<Link>(`/public/guardian/${encodeURIComponent(token)}/${path}`, { body: {} }));
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (data === undefined) return <p className="muted center" style={{ paddingTop: 80 }}>Loading...</p>;
  if (data === null) {
    return (
      <main className="center" style={{ padding: "80px 16px" }}>
        <h1>This link no longer works</h1>
        <p className="muted">The student may have changed or removed the address. No more emails will be sent to it.</p>
      </main>
    );
  }
  const first = data.student.split(" ")[0];
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 16px" }}>
      <div className="card stack">
        <div className="muted small">PlayCode · {data.institution}</div>
        <h1 style={{ margin: 0 }}>Monthly progress emails</h1>
        <p style={{ margin: 0 }}>
          Dear {data.name}, {data.student} practises for campus placements on PlayCode and would like you to receive a short email on the 1st of each month about how their preparation is going.
        </p>
        {data.status === "waiting" && (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              It covers the days {first} practised, their placement readiness, attendance in training sessions, class test marks and placement drives. You can stop it from any of the emails.
            </p>
            <div className="row wrap">
              <button className="btn primary" disabled={busy} onClick={() => act("confirm")}>
                Yes, send me the monthly email
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => act("stop")}>
                No thanks
              </button>
            </div>
          </>
        )}
        {data.status === "active" && (
          <>
            <div role="status" style={{ color: "var(--good-ink)", fontWeight: 600 }}>
              ✓ Confirmed: the first email comes on the 1st of next month.
            </div>
            <button className="btn ghost small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => act("stop")}>
              Stop these emails
            </button>
          </>
        )}
        {data.status === "stopped" && (
          <div role="status" style={{ fontWeight: 600 }}>
            Stopped: you won&apos;t receive any more emails about {first}.
          </div>
        )}
        {msg && <div className="small" style={{ color: "var(--bad-ink)" }}>{msg}</div>}
      </div>
    </main>
  );
}
