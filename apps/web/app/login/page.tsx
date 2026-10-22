"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { api, API_URL, errorMessage, setToken } from "@/lib/api";
import { applyBranding, logoSrc } from "@/lib/branding";
import { storedLocale, translate, type Locale } from "@/lib/i18n";
import type { Me, PublicBranding, SsoProvider } from "@/lib/types";

// Quick sign-in buttons for the seeded demo. Set NEXT_PUBLIC_DEMO_LOGINS=false in real deployments.
const SHOW_DEMO = process.env.NEXT_PUBLIC_DEMO_LOGINS !== "false";
const DEMO = [
  { label: "Student", email: "student@demo.edu" },
  { label: "Faculty", email: "faculty@demo.edu" },
  { label: "TPO", email: "tpo@demo.edu" },
  { label: "HOD", email: "hod.cse@demo.edu" },
  { label: "Inst. admin", email: "admin@demo.edu" },
];

const SSO_LABEL: Record<SsoProvider, string> = {
  google: "Sign in with Google",
  microsoft: "Sign in with Microsoft",
  oidc: "Sign in with your institution account",
  saml: "Sign in with your institution account",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const org = params.get("org");
  const ssoError = params.get("sso_error");
  const [brand, setBrand] = useState<PublicBranding | null>(null);
  // The language picked on this device before; read after mount so the server render matches.
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    const l = storedLocale();
    setLocale(l);
    document.documentElement.lang = l;
  }, []);
  const t = (text: string) => translate(locale, text);
  useEffect(() => {
    if (!org) return;
    api<PublicBranding>(`/public/branding/${encodeURIComponent(org)}`)
      .then((b) => {
        setBrand(b);
        applyBranding(b);
      })
      .catch(() => setBrand(null));
  }, [org]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(ssoError);
  const [busy, setBusy] = useState(false);
  // password -> (optional) two-factor code; or email -> sign-in code -> (optional) two-factor code
  const [step, setStep] = useState<"password" | "codeRequest" | "code" | "mfa">("password");
  const [code, setCode] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [channels, setChannels] = useState<{ email: boolean; whatsapp: boolean }>({ email: false, whatsapp: false });
  useEffect(() => {
    void api<{ email: boolean; whatsapp: boolean }>("/auth/otp/channels").then(setChannels).catch(() => {});
  }, []);

  type SignInResult = (Me & { token: string }) | { mfaRequired: true; mfaToken: string };

  function finish(res: SignInResult) {
    if ("mfaRequired" in res) {
      setMfaToken(res.mfaToken);
      setCode("");
      setStep("mfa");
      setBusy(false);
      return;
    }
    setToken(res.token);
    router.replace(res.home === "console" ? "/console" : "/play");
  }

  async function call(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      finish(await api<SignInResult>(path, { body }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function signIn(e?: FormEvent, override?: { email: string; password: string }) {
    e?.preventDefault();
    await call("/auth/login", override ?? { email, password });
  }

  async function sendCode(channel: "email" | "whatsapp") {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/otp/request", { body: { email, channel } });
      setNotice(t(channel === "whatsapp" ? "If this email has an account with a phone number, a code is on its way to WhatsApp." : "If this email has an account, a code is on its way. Check your inbox."));
      setCode("");
      setStep("code");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "64px 16px" }}>
      <div className="row" style={{ marginBottom: 24 }}>
        <img src={logoSrc(brand)} alt="" width={40} height={40} style={{ objectFit: "contain" }} />
        <div>
          <h1 style={{ margin: 0 }}>{brand?.appName ?? "PlayCode"}</h1>
          <div className="muted small">{brand ? brand.tenantName : t("Level up your coding for placements")}</div>
        </div>
      </div>
      {brand?.sso && step === "password" && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <a className="btn primary big" href={`${API_URL}/auth/sso/start?org=${encodeURIComponent(brand.slug)}`}>
            {t(SSO_LABEL[brand.sso.provider])}
          </a>
          <div className="muted small" style={{ textAlign: "center" }}>
            {t("or sign in with your PlayCode password below")}
          </div>
        </div>
      )}
      {step === "password" && (
        <form className="card stack" onSubmit={signIn}>
          <div>
            <label htmlFor="email">{t("Email")}</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="password">{t("Password")}</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn primary big" disabled={busy}>
            {busy ? t("Signing in...") : t("Sign in")}
          </button>
          {(channels.email || channels.whatsapp) && (
            <button type="button" className="btn ghost small" onClick={() => { setError(null); setStep("codeRequest"); }}>
              {t("Forgot your password? Get a sign-in code instead")}
            </button>
          )}
        </form>
      )}
      {step === "codeRequest" && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void sendCode("email"); }}>
          <div>
            <label htmlFor="otp-email">{t("Email")}</label>
            <input id="otp-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          {channels.email && (
            <button className="btn primary big" disabled={busy || !email}>
              {t("Email me a code")}
            </button>
          )}
          {channels.whatsapp && (
            <button type="button" className="btn big" disabled={busy || !email} onClick={() => sendCode("whatsapp")}>
              {t("Send the code to my WhatsApp")}
            </button>
          )}
          <button type="button" className="btn ghost small" onClick={() => setStep("password")}>
            {t("Back to password sign-in")}
          </button>
        </form>
      )}
      {(step === "code" || step === "mfa") && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            void (step === "code" ? call("/auth/otp/verify", { email, code }) : call("/auth/login/2fa", { mfaToken, code }));
          }}
        >
          {step === "code" ? notice && <div className="small muted">{notice}</div> : <div className="small muted">{t("Open your authenticator app and enter the 6-digit code for PlayCode. Lost your phone? Use a recovery code.")}</div>}
          <div>
            <label htmlFor="code">{t(step === "code" ? "Sign-in code" : "Two-factor code")}</label>
            <input id="code" inputMode={step === "code" ? "numeric" : "text"} autoComplete="one-time-code" maxLength={step === "code" ? 6 : 20} value={code} onChange={(e) => setCode(e.target.value.trim())} required autoFocus />
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn primary big" disabled={busy || code.length < 6}>
            {busy ? t("Checking...") : t("Continue")}
          </button>
          <button type="button" className="btn ghost small" onClick={() => { setStep("password"); setError(null); }}>
            {t("Start again")}
          </button>
        </form>
      )}
      {SHOW_DEMO && !brand && (
      <div className="card stack" style={{ marginTop: 16 }}>
        <div className="muted small">Demo accounts (password playcode123)</div>
        <div className="row wrap">
          {DEMO.map((d) => (
            <button key={d.email} className="btn small" disabled={busy} onClick={() => signIn(undefined, { email: d.email, password: "playcode123" })}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      )}
    </main>
  );
}

export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
