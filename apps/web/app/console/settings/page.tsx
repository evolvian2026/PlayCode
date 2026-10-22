"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { applyBranding, logoSrc } from "@/lib/branding";
import type { Branding, SsoProvider } from "@/lib/types";

interface BrandingResponse {
  own: { appName?: string; primaryColor?: string; certificateSignatory?: string; logoKey?: string };
  effective: Branding;
}

interface SsoResponse {
  connection: { provider: SsoProvider; issuer: string; clientId: string; emailDomains: string[]; autoProvisionUnitId: string | null; enabled: boolean } | null;
  redirectUri: string;
  presets: { google: string; microsoft: string };
}

function SsoSettings() {
  const { data, error, loading, reload } = useApi<SsoResponse>("/console/sso");
  const units = useApi<{ units: { id: string; name: string }[] }>("/console/org-units");
  const [provider, setProvider] = useState<SsoProvider>("google");
  const [directory, setDirectory] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [domains, setDomains] = useState("");
  const [unitId, setUnitId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const c = data?.connection;
    if (!c) return;
    setProvider(c.provider);
    setIssuer(c.issuer);
    setDirectory(c.provider === "microsoft" ? (c.issuer.match(/microsoftonline\.com\/([^/]+)\//)?.[1] ?? "") : "");
    setClientId(c.clientId);
    setDomains(c.emailDomains.join(", "));
    setUnitId(c.autoProvisionUnitId ?? "");
    setEnabled(c.enabled);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  const effectiveIssuer = provider === "google" ? data.presets.google : provider === "microsoft" ? data.presets.microsoft.replace("{tenant-id}", directory.trim()) : issuer.trim();

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setMsg(null);
    try {
      await api("/console/sso", {
        method: "PUT",
        body: {
          provider,
          issuer: effectiveIssuer,
          clientId: clientId.trim(),
          ...(secret ? { clientSecret: secret } : {}),
          emailDomains: domains.split(/[\s,]+/).filter(Boolean),
          autoProvisionUnitId: unitId || null,
          enabled,
        },
      });
      setSecret("");
      setMsg(enabled ? "Saved. The sign-in page now offers single sign-on." : "Saved. Single sign-on is off.");
      reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>Single sign-on</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Let students and staff sign in with their college Google or Microsoft account. Register PlayCode as an app with your provider, using this redirect URI:
      </p>
      <code className="inline-code" style={{ alignSelf: "flex-start", wordBreak: "break-all" }}>
        {data.redirectUri}
      </code>
      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="s-prov">Provider</label>
          <select id="s-prov" value={provider} onChange={(e) => setProvider(e.target.value as SsoProvider)}>
            <option value="google">Google Workspace</option>
            <option value="microsoft">Microsoft Entra ID</option>
            <option value="oidc">Other OpenID Connect</option>
          </select>
        </div>
        {provider === "microsoft" && (
          <div style={{ flex: 2, minWidth: 240 }}>
            <label htmlFor="s-dir">Directory (tenant) ID</label>
            <input id="s-dir" value={directory} onChange={(e) => setDirectory(e.target.value)} required placeholder="00000000-0000-0000-0000-000000000000" />
          </div>
        )}
        {provider === "oidc" && (
          <div style={{ flex: 2, minWidth: 240 }}>
            <label htmlFor="s-iss">Issuer URL</label>
            <input id="s-iss" type="url" value={issuer} onChange={(e) => setIssuer(e.target.value)} required placeholder="https://login.example.edu" />
          </div>
        )}
      </div>
      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="s-cid">Client ID</label>
          <input id="s-cid" value={clientId} onChange={(e) => setClientId(e.target.value)} required />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="s-sec">Client secret</label>
          <input id="s-sec" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} required={!data.connection} placeholder={data.connection ? "Leave empty to keep the saved secret" : ""} />
        </div>
      </div>
      <div>
        <label htmlFor="s-dom">Allowed email domains</label>
        <input id="s-dom" value={domains} onChange={(e) => setDomains(e.target.value)} required placeholder="college.edu, students.college.edu" />
      </div>
      <div>
        <label htmlFor="s-unit">New accounts</label>
        <select id="s-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">Only people already added to PlayCode can sign in</option>
          {(units.data?.units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              Create student accounts automatically in {u.name}
            </option>
          ))}
        </select>
      </div>
      <label>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: "auto", marginRight: 6 }} />
        Show single sign-on on the sign-in page
      </label>
      {saveError && <ErrorBox message={saveError} />}
      {msg && <span className="pill good">{msg}</span>}
      <button className="btn primary" style={{ alignSelf: "flex-start" }}>
        Save single sign-on
      </button>
    </form>
  );
}

function AiSettings() {
  const { data, error, reload, setData } = useApi<{ configured: boolean; hints: boolean; proctoring: boolean }>("/console/ai");
  const [saveError, setSaveError] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return null;
  async function save(next: { hints: boolean; proctoring: boolean }) {
    setSaveError(null);
    try {
      setData(await api<{ configured: boolean; hints: boolean; proctoring: boolean }>("/console/ai", { method: "PUT", body: next }));
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  }
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>AI features</h2>
      {!data.configured && (
        <p className="small muted" style={{ margin: 0 }}>
          AI is not set up on this PlayCode server yet. These switches take effect once it is.
        </p>
      )}
      <label>
        <input type="checkbox" checked={data.hints} onChange={(e) => save({ ...data, hints: e.target.checked })} style={{ width: "auto", marginRight: 6 }} />
        AI coach in practice: students can ask for a hint tailored to the question and their code (costs XP like a written hint; never in tests or duels)
      </label>
      <label>
        <input type="checkbox" checked={data.proctoring} onChange={(e) => save({ ...data, proctoring: e.target.checked })} style={{ width: "auto", marginRight: 6 }} />
        AI review of webcam snapshots in strict tests: flags no face, more than one person, or a phone for the proctor to check
      </label>
      {saveError && <ErrorBox message={saveError} />}
    </div>
  );
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function Settings() {
  const { data, error, loading, reload, setData } = useApi<BrandingResponse>("/console/branding");
  const [appName, setAppName] = useState("");
  const [color, setColor] = useState("#5b4bff");
  const [useColor, setUseColor] = useState(false);
  const [signatory, setSignatory] = useState("");
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setAppName(data.own.appName ?? "");
    setUseColor(Boolean(data.own.primaryColor));
    setColor(data.own.primaryColor ?? data.effective.primaryColor ?? "#5b4bff");
    setSignatory(data.own.certificateSignatory ?? "");
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    try {
      const r = await api<BrandingResponse>("/console/branding", {
        method: "PUT",
        body: { appName: appName || null, primaryColor: useColor ? color : null, certificateSignatory: signatory || null, ...(logo !== undefined ? { logo } : {}) },
      });
      setData(r);
      setLogo(undefined);
      applyBranding(r.effective);
      setMsg("Saved. Students see the new branding the next time they open the app.");
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const previewLogo = logo ?? (logo === null ? "/icon.svg" : logoSrc(data.effective));
  const loginLink = `${typeof window === "undefined" ? "" : window.location.origin}/login?org=${data.effective.slug}`;

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
      <h1 style={{ margin: 0 }}>Settings</h1>
      <form className="card stack" onSubmit={save}>
        <h2 style={{ margin: 0 }}>Branding</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Your name, colour and logo appear on the sign-in page, in the app and on certificates. Leave a field empty to use {data.effective.appName === "PlayCode" ? "the PlayCode default" : "your partner's"}.
        </p>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="b-name">App name</label>
            <input id="b-name" value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={40} placeholder={data.effective.appName} />
          </div>
          <div>
            <label htmlFor="b-color">
              <input type="checkbox" checked={useColor} onChange={(e) => setUseColor(e.target.checked)} style={{ width: "auto", marginRight: 6 }} />
              Brand colour
            </label>
            <input id="b-color" type="color" value={color} disabled={!useColor} onChange={(e) => setColor(e.target.value)} style={{ width: 80, height: 42, padding: 4 }} />
          </div>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <img src={previewLogo} alt="Logo preview" width={56} height={56} style={{ objectFit: "contain", borderRadius: 10, border: "1px solid var(--border)", padding: 4 }} />
          <div className="stack" style={{ gap: 4 }}>
            <label htmlFor="b-logo" style={{ margin: 0 }}>
              Logo (PNG, JPEG or WebP, under 200 KB)
            </label>
            <input
              id="b-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setLogo(await readFile(f));
              }}
            />
            {data.own.logoKey && (
              <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setLogo(null)}>
                Remove logo
              </button>
            )}
          </div>
        </div>
        <div>
          <label htmlFor="b-sign">Certificate signatory</label>
          <input id="b-sign" value={signatory} onChange={(e) => setSignatory(e.target.value)} maxLength={80} placeholder="e.g. Training & Placement Officer" />
        </div>
        {saveError && <ErrorBox message={saveError} />}
        {msg && <span className="pill good">{msg}</span>}
        <button className="btn primary" style={{ alignSelf: "flex-start" }}>
          Save branding
        </button>
      </form>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Your sign-in link</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Share this with students: it opens a sign-in page with your branding.
        </p>
        <code className="inline-code" style={{ alignSelf: "flex-start" }}>
          {loginLink}
        </code>
      </div>
      <AiSettings />
      <SsoSettings />
    </div>
  );
}
