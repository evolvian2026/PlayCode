"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { ErrorBox } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Session {
  id: string;
  method: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

const METHOD: Record<string, string> = { password: "Password", otp: "Sign-in code", sso: "Single sign-on", saml: "SAML", lti: "From your LMS", apply: "Drive application" };

/** A short device name from a user agent string. */
function device(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return os ? `${browser} on ${os}` : browser;
}

export function DevicesCard() {
  const t = useT();
  const { data, error, reload } = useApi<{ sessions: Session[] }>("/auth/sessions");
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return null;
  async function act(path: string) {
    setBusy(true);
    await api(path, { body: {} }).catch(() => {});
    setBusy(false);
    reload();
  }
  const others = data.sessions.filter((s) => !s.current).length;
  return (
    <div className="card stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>{t("Signed-in devices")}</h2>
        {others > 0 && (
          <button className="btn small" disabled={busy} onClick={() => act("/auth/sessions/revoke-others")}>
            {t("Sign out other devices")}
          </button>
        )}
      </div>
      {data.sessions.map((s) => (
        <div key={s.id} className="spread" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <div>
            <div style={{ fontWeight: 600 }}>
              {device(s.userAgent)} {s.current && <span className="pill good">{t("This device")}</span>}
            </div>
            <div className="small muted">
              {METHOD[s.method] ?? s.method} · signed in {new Date(s.createdAt).toLocaleString()} · last active {new Date(s.lastSeenAt).toLocaleString()}
            </div>
          </div>
          {!s.current && (
            <button className="btn small ghost" disabled={busy} onClick={() => act(`/auth/sessions/${s.id}/revoke`)}>
              Sign out
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function TwoFactorCard({ onEnabled }: { onEnabled?: () => void }) {
  const { data, error, reload } = useApi<{ enabled: boolean; required: boolean; recoveryCodesLeft: number }>("/auth/2fa");
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 180 }).then(setQr);
  }, [setup]);

  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return null;

  async function run(fn: () => Promise<void>) {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  return (
    <div className="card stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Two-factor sign-in</h2>
        <span className={`pill ${data.enabled ? "good" : data.required ? "bad" : ""}`}>{data.enabled ? "On" : data.required ? "Required" : "Off"}</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        After your password, you type a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy). Someone who learns your
        password still can&apos;t get in.
      </p>
      {codes && (
        <div className="card tight stack" style={{ background: "var(--warn-soft)", borderColor: "transparent" }}>
          <b>Save these recovery codes</b>
          <span className="small">Each works once if you lose your phone. They won&apos;t be shown again.</span>
          <code className="inline-code" style={{ whiteSpace: "pre-wrap" }}>{codes.join("   ")}</code>
        </div>
      )}
      {!data.enabled && !setup && (
        <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => run(async () => setSetup(await api("/auth/2fa/setup", { body: {} })))}>
          Set up two-factor sign-in
        </button>
      )}
      {!data.enabled && setup && (
        <div className="stack">
          <div className="row wrap" style={{ alignItems: "flex-start" }}>
            {qr && <img src={qr} alt="QR code for your authenticator app" width={180} height={180} />}
            <div className="small stack" style={{ gap: 6, flex: 1, minWidth: 220 }}>
              <span>1. Scan the code with your authenticator app, or type this key:</span>
              <code className="inline-code" style={{ wordBreak: "break-all" }}>{setup.secret}</code>
              <span>2. Enter the 6-digit code it shows:</span>
              <div className="row">
                <input aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ width: 140 }} />
                <button
                  className="btn primary"
                  disabled={code.length !== 6}
                  onClick={() =>
                    run(async () => {
                      const r = await api<{ recoveryCodes: string[] }>("/auth/2fa/enable", { body: { code } });
                      setCodes(r.recoveryCodes);
                      setSetup(null);
                      reload();
                      onEnabled?.();
                    })
                  }
                >
                  Turn on
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {data.enabled && <div className="small muted">{data.recoveryCodesLeft} recovery codes left.</div>}
      {data.enabled && !data.required && (
        <div className="row">
          <input aria-label="Code to turn off" placeholder="Code from your app" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} style={{ width: 180 }} />
          <button className="btn ghost" disabled={code.length < 6} onClick={() => run(async () => { await api("/auth/2fa/disable", { body: { code } }); setCode(""); reload(); })}>
            Turn off
          </button>
        </div>
      )}
      {actionError && <ErrorBox message={actionError} />}
    </div>
  );
}
