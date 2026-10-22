"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, formatDate, Loading } from "@/components/ui";
import { api, errorMessage, setToken } from "@/lib/api";
import { applyBranding, logoSrc } from "@/lib/branding";
import type { Branding } from "@/lib/types";

interface DriveInfo {
  title: string;
  roleTitle: string;
  description: string;
  company: string;
  branding: Branding;
  durationMinutes: number;
  proctorLevel: 1 | 2;
  openAt: string;
  closeAt: string;
  accepting: boolean;
}

/** Public page where candidates apply to a hiring drive and go straight to the test. */
export default function Apply() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [drive, setDrive] = useState<DriveInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", college: "", password: "" });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<DriveInfo>(`/public/drives/${encodeURIComponent(code)}`)
      .then((d) => {
        setDrive(d);
        applyBranding(d.branding);
      })
      .catch(() => setNotFound(true));
  }, [code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; assessmentId: string }>(`/public/drives/${encodeURIComponent(code)}/apply`, {
        body: { name: form.name, email: form.email, password: form.password, phone: form.phone || undefined, college: form.college || undefined, consent },
      });
      setToken(r.token);
      router.replace(`/play/tests/${r.assessmentId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (notFound) return <main className="center" style={{ padding: "80px 16px" }}><h1>This link is not valid</h1><p className="muted">Check the link from the recruiter.</p></main>;
  if (!drive) return <Loading />;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "40px 16px" }} className="stack">
      <div className="row">
        <img src={logoSrc(drive.branding)} alt="" width={44} height={44} style={{ objectFit: "contain" }} />
        <div>
          <div className="muted small">{drive.company} is hiring</div>
          <h1 style={{ margin: 0 }}>{drive.roleTitle}</h1>
        </div>
      </div>
      <div className="card stack" style={{ gap: 6 }}>
        <b>{drive.title}</b>
        {drive.description && <p style={{ margin: 0, whiteSpace: "pre-line" }}>{drive.description}</p>}
        <span className="muted small">
          Online test · {drive.durationMinutes} minutes · open until {formatDate(drive.closeAt)}
          {drive.proctorLevel === 2 ? " · camera and full screen required" : ""}
        </span>
      </div>
      {!drive.accepting ? (
        <div className="card">This drive is no longer accepting applications.</div>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <h2 style={{ margin: 0 }}>Apply and start the test</h2>
          <div>
            <label htmlFor="a-name">Full name</label>
            <input id="a-name" value={form.name} onChange={set("name")} required minLength={2} autoComplete="name" />
          </div>
          <div>
            <label htmlFor="a-email">Email</label>
            <input id="a-email" type="email" value={form.email} onChange={set("email")} required autoComplete="email" />
          </div>
          <div className="row wrap">
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="a-phone">Phone (optional)</label>
              <input id="a-phone" value={form.phone} onChange={set("phone")} autoComplete="tel" />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="a-college">College (optional)</label>
              <input id="a-college" value={form.college} onChange={set("college")} />
            </div>
          </div>
          <div>
            <label htmlFor="a-pass">Choose a password</label>
            <input id="a-pass" type="password" value={form.password} onChange={set("password")} required minLength={8} autoComplete="new-password" />
          </div>
          <label className="row small" style={{ fontWeight: 400, alignItems: "flex-start", gap: 8 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: "auto", marginTop: 3 }} />
            <span>
              I agree that {drive.company} and PlayCode may use my details and test results to assess my application, and that the test records tab switches
              {drive.proctorLevel === 2 ? " and takes webcam photos" : ""}. I can ask for my data to be deleted at any time.
            </span>
          </label>
          {error && <ErrorBox message={error} />}
          <button className="btn primary big" disabled={busy || !consent}>
            {busy ? "Creating your account..." : "Apply"}
          </button>
        </form>
      )}
    </main>
  );
}
