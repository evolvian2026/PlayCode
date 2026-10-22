"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, setToken } from "@/lib/api";
import { applyBranding, logoSrc } from "@/lib/branding";
import type { Branding, Me } from "@/lib/types";

// Quick sign-in buttons for the seeded demo. Set NEXT_PUBLIC_DEMO_LOGINS=false in real deployments.
const SHOW_DEMO = process.env.NEXT_PUBLIC_DEMO_LOGINS !== "false";
const DEMO = [
  { label: "Student", email: "student@demo.edu" },
  { label: "Faculty", email: "faculty@demo.edu" },
  { label: "TPO", email: "tpo@demo.edu" },
  { label: "HOD", email: "hod.cse@demo.edu" },
  { label: "Inst. admin", email: "admin@demo.edu" },
];

function LoginForm() {
  const router = useRouter();
  const org = useSearchParams().get("org");
  const [brand, setBrand] = useState<Branding | null>(null);
  useEffect(() => {
    if (!org) return;
    api<Branding>(`/public/branding/${encodeURIComponent(org)}`)
      .then((b) => {
        setBrand(b);
        applyBranding(b);
      })
      .catch(() => setBrand(null));
  }, [org]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e?: FormEvent, override?: { email: string; password: string }) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<Me & { token: string }>("/auth/login", { body: override ?? { email, password } });
      setToken(res.token);
      router.replace(res.home === "console" ? "/console" : "/play");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "64px 16px" }}>
      <div className="row" style={{ marginBottom: 24 }}>
        <img src={logoSrc(brand)} alt="" width={40} height={40} style={{ objectFit: "contain" }} />
        <div>
          <h1 style={{ margin: 0 }}>{brand?.appName ?? "PlayCode"}</h1>
          <div className="muted small">{brand ? brand.tenantName : "Level up your coding for placements"}</div>
        </div>
      </div>
      <form className="card stack" onSubmit={signIn}>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn primary big" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
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
