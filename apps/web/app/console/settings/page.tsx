"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { api, errorMessage, useApi } from "@/lib/api";
import { applyBranding, logoSrc } from "@/lib/branding";
import type { Branding } from "@/lib/types";

interface BrandingResponse {
  own: { appName?: string; primaryColor?: string; certificateSignatory?: string; logoKey?: string };
  effective: Branding;
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
    </div>
  );
}
