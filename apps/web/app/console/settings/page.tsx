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

interface SamlInfo {
  connection: { idpEntityId: string; ssoUrl: string; certificates: string[]; emailAttribute: string | null; emailDomains: string[]; autoProvisionUnitId: string | null; enabled: boolean } | null;
  sp: { entityId: string; acsUrl: string; metadataUrl: string };
}

function SamlSettings() {
  const { data, error, reload } = useApi<SamlInfo>("/console/saml");
  const units = useApi<{ units: { id: string; name: string }[] }>("/console/org-units");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ idpEntityId: "", ssoUrl: "", cert: "", emailAttribute: "", emailDomains: "", autoProvisionUnitId: "", enabled: true });
  const [metadata, setMetadata] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const c = data?.connection;
    if (!c) return;
    setF({ idpEntityId: c.idpEntityId, ssoUrl: c.ssoUrl, cert: c.certificates[0] ?? "", emailAttribute: c.emailAttribute ?? "", emailDomains: c.emailDomains.join(", "), autoProvisionUnitId: c.autoProvisionUnitId ?? "", enabled: c.enabled });
  }, [data]);

  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return null;

  async function importMetadata() {
    setSaveError(null);
    try {
      const m = await api<{ idpEntityId: string; ssoUrl: string; certificates: string[] }>("/console/saml/metadata", { body: { xml: metadata } });
      setF({ ...f, idpEntityId: m.idpEntityId, ssoUrl: m.ssoUrl, cert: m.certificates[0] ?? "" });
      setMsg("Read the metadata. Check the fields and save.");
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setMsg(null);
    try {
      await api("/console/saml", {
        method: "PUT",
        body: {
          idpEntityId: f.idpEntityId.trim(),
          ssoUrl: f.ssoUrl.trim(),
          certificates: [f.cert],
          emailAttribute: f.emailAttribute.trim() || null,
          emailDomains: f.emailDomains.split(/[\s,]+/).filter(Boolean),
          autoProvisionUnitId: f.autoProvisionUnitId || null,
          enabled: f.enabled,
        },
      });
      setMsg(f.enabled ? "Saved. The sign-in page now uses SAML." : "Saved. SAML is off.");
      reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  }

  return (
    <div className="card stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>SAML 2.0</h2>
        {data.connection?.enabled && <span className="pill good">On</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        For identity providers such as ADFS, Shibboleth or Okta. When SAML is on, the sign-in page uses it instead of OpenID Connect. Give your IdP admin these
        details (or the metadata URL):
      </p>
      <div className="stack small" style={{ gap: 4 }}>
        <div>
          Entity ID: <code className="inline-code">{data.sp.entityId}</code>
        </div>
        <div>
          Assertion consumer service (HTTP-POST): <code className="inline-code">{data.sp.acsUrl}</code>
        </div>
        <div>
          Metadata: <code className="inline-code">{data.sp.metadataUrl}</code>
        </div>
        <div className="muted">Sign assertions, and send the email as the NameID (email format) or as an attribute.</div>
      </div>
      {!open ? (
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
          {data.connection ? "Edit SAML settings" : "Set up SAML"}
        </button>
      ) : (
        <form className="stack" onSubmit={save}>
          <div>
            <label htmlFor="saml-md">Paste your IdP&apos;s metadata XML (optional, fills the fields below)</label>
            <textarea id="saml-md" rows={3} className="mono" value={metadata} onChange={(e) => setMetadata(e.target.value)} />
            <button type="button" className="btn small" disabled={!metadata.trim()} onClick={importMetadata}>
              Read metadata
            </button>
          </div>
          <div className="row wrap">
            <div style={{ flex: 1, minWidth: 240 }}>
              <label htmlFor="saml-entity">IdP entity ID</label>
              <input id="saml-entity" value={f.idpEntityId} onChange={(e) => setF({ ...f, idpEntityId: e.target.value })} required />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label htmlFor="saml-sso">Single sign-on URL (HTTP-Redirect)</label>
              <input id="saml-sso" type="url" value={f.ssoUrl} onChange={(e) => setF({ ...f, ssoUrl: e.target.value })} required />
            </div>
          </div>
          <div>
            <label htmlFor="saml-cert">IdP signing certificate</label>
            <textarea id="saml-cert" rows={4} className="mono" value={f.cert} onChange={(e) => setF({ ...f, cert: e.target.value })} required placeholder="-----BEGIN CERTIFICATE-----" />
          </div>
          <div className="row wrap">
            <div style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="saml-domains">Allowed email domains</label>
              <input id="saml-domains" value={f.emailDomains} onChange={(e) => setF({ ...f, emailDomains: e.target.value })} required placeholder="college.edu" />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="saml-attr">Email attribute (optional)</label>
              <input id="saml-attr" value={f.emailAttribute} onChange={(e) => setF({ ...f, emailAttribute: e.target.value })} placeholder="Leave empty to use the NameID" />
            </div>
          </div>
          <div>
            <label htmlFor="saml-unit">New accounts</label>
            <select id="saml-unit" value={f.autoProvisionUnitId} onChange={(e) => setF({ ...f, autoProvisionUnitId: e.target.value })}>
              <option value="">Only people already added to PlayCode can sign in</option>
              {(units.data?.units ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  Create student accounts automatically in {u.name}
                </option>
              ))}
            </select>
          </div>
          <label className="row" style={{ gap: 6, fontWeight: 500 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Use SAML on the sign-in page
          </label>
          {saveError && <ErrorBox message={saveError} />}
          {msg && <span className="pill good" style={{ alignSelf: "flex-start" }}>{msg}</span>}
          <div className="row">
            <button className="btn primary">Save SAML</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

interface LtiPlatform {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  deploymentIds: string[];
  authLoginUrl: string;
  authTokenUrl: string;
  jwksUrl: string;
  autoProvisionUnitId: string | null;
  enabled: boolean;
}

const EMPTY_PLATFORM = { name: "", issuer: "", clientId: "", deploymentIds: "", authLoginUrl: "", authTokenUrl: "", jwksUrl: "", autoProvisionUnitId: "" };

/** Endpoint patterns for common LMSs, filled in from the site address. */
function lmsPreset(kind: "moodle" | "canvas", site: string) {
  const base = site.trim().replace(/\/$/, "");
  if (kind === "moodle") return { issuer: base, authLoginUrl: `${base}/mod/lti/auth.php`, authTokenUrl: `${base}/mod/lti/token.php`, jwksUrl: `${base}/mod/lti/certs.php` };
  return { issuer: "https://canvas.instructure.com", authLoginUrl: "https://sso.canvaslms.com/api/lti/authorize_redirect", authTokenUrl: "https://sso.canvaslms.com/login/oauth2/token", jwksUrl: "https://sso.canvaslms.com/api/lti/security/jwks" };
}

function LtiSettings() {
  const { data, error, reload } = useApi<{ tool: { loginUrl: string; launchUrl: string; jwksUrl: string }; platforms: LtiPlatform[] }>("/console/lti");
  const units = useApi<{ units: { id: string; name: string }[] }>("/console/org-units");
  const [f, setF] = useState(EMPTY_PLATFORM);
  const [site, setSite] = useState("");
  const [adding, setAdding] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (!data) return null;

  async function add(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    try {
      await api("/console/lti/platforms", {
        body: { ...f, deploymentIds: f.deploymentIds.split(/[\s,]+/).filter(Boolean), autoProvisionUnitId: f.autoProvisionUnitId || null, enabled: true },
      });
      setF(EMPTY_PLATFORM);
      setAdding(false);
      reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  }

  async function toggle(p: LtiPlatform) {
    try {
      await api(`/console/lti/platforms/${p.id}`, { method: "PUT", body: { ...p, enabled: !p.enabled } });
      reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  }

  async function remove(p: LtiPlatform) {
    if (!window.confirm(`Disconnect ${p.name}? Activities placed in its courses will stop working.`)) return;
    await api(`/console/lti/platforms/${p.id}`, { method: "DELETE" }).catch((err) => setSaveError(errorMessage(err)));
    reload();
  }

  const field = (key: keyof typeof EMPTY_PLATFORM, label: string, placeholder = "") => (
    <div style={{ flex: 1, minWidth: 220 }}>
      <label htmlFor={`lti-${key}`}>{label}</label>
      <input id={`lti-${key}`} value={f[key]} placeholder={placeholder} onChange={(e) => setF({ ...f, [key]: e.target.value })} required={key !== "deploymentIds" && key !== "autoProvisionUnitId"} />
    </div>
  );

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>LMS (LTI 1.3)</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Put PlayCode assignments inside Moodle, Canvas or any LTI 1.3 LMS. Students open them from their course without a separate password, and scores go to
        the course gradebook. Give your LMS admin these tool details:
      </p>
      <div className="stack small" style={{ gap: 4 }}>
        <div>
          Login initiation URL: <code className="inline-code">{data.tool.loginUrl}</code>
        </div>
        <div>
          Redirect / launch URL: <code className="inline-code">{data.tool.launchUrl}</code>
        </div>
        <div>
          Public keyset (JWKS) URL: <code className="inline-code">{data.tool.jwksUrl}</code>
        </div>
        <div>
          Content selection (deep linking) URL: <code className="inline-code">{data.tool.launchUrl}</code>
        </div>
        <div className="muted">Turn on Assignment and Grade Services (scores) and content selection, share name and email, and open the tool in a new window.</div>
      </div>
      {data.platforms.map((p) => (
        <div key={p.id} className="spread wrap" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <div>
            <b>{p.name}</b> <span className="small muted">{p.issuer} · client {p.clientId}</span>
          </div>
          <div className="row">
            <span className={`pill ${p.enabled ? "good" : ""}`}>{p.enabled ? "Connected" : "Off"}</span>
            <button className="btn small" onClick={() => toggle(p)}>
              {p.enabled ? "Turn off" : "Turn on"}
            </button>
            <button className="btn small ghost" onClick={() => remove(p)}>
              Remove
            </button>
          </div>
        </div>
      ))}
      {!adding ? (
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
          Connect an LMS
        </button>
      ) : (
        <form className="stack" onSubmit={add} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="lti-site">Moodle site address (to fill in the URLs)</label>
              <input id="lti-site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://lms.college.edu" />
            </div>
            <button type="button" className="btn small" disabled={!site.trim()} onClick={() => setF({ ...f, name: f.name || "Moodle", ...lmsPreset("moodle", site) })}>
              Fill for Moodle
            </button>
            <button type="button" className="btn small" onClick={() => setF({ ...f, name: f.name || "Canvas", ...lmsPreset("canvas", "") })}>
              Fill for Canvas
            </button>
          </div>
          <div className="row wrap">
            {field("name", "Name", "College Moodle")}
            {field("clientId", "Client ID (from the LMS)")}
            {field("deploymentIds", "Deployment IDs (optional)", "1")}
          </div>
          <div className="row wrap">
            {field("issuer", "Platform ID (issuer)")}
            {field("authLoginUrl", "Authentication request URL")}
          </div>
          <div className="row wrap">
            {field("authTokenUrl", "Access token URL")}
            {field("jwksUrl", "Public keyset URL")}
          </div>
          <div>
            <label htmlFor="lti-unit">New students from the LMS</label>
            <select id="lti-unit" value={f.autoProvisionUnitId} onChange={(e) => setF({ ...f, autoProvisionUnitId: e.target.value })}>
              <option value="">Only students already in PlayCode can launch</option>
              {(units.data?.units ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  Create their account in {u.name}
                </option>
              ))}
            </select>
          </div>
          {saveError && <ErrorBox message={saveError} />}
          <div className="row">
            <button className="btn primary">Save LMS</button>
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {saveError && !adding && <ErrorBox message={saveError} />}
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
      <SamlSettings />
      <LtiSettings />
    </div>
  );
}
