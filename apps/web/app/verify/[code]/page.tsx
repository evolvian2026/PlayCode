"use client";

import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { applyBranding, logoSrc } from "@/lib/branding";
import type { Branding } from "@/lib/types";

interface Verified {
  valid: boolean;
  revoked?: boolean;
  code?: string;
  holder?: string;
  title?: string;
  scorePct?: number;
  issuedAt?: string;
  institution?: string;
  branding?: Branding;
}

/** Public, printable certificate. Anyone with the link (or the QR code) can verify it. */
export default function VerifyCertificate() {
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<Verified | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    api<Verified>(`/public/certificates/${encodeURIComponent(code)}`)
      .then((d) => {
        setData(d);
        if (d.branding) applyBranding(d.branding);
      })
      .catch(() => setData({ valid: false }));
    QRCode.toString(window.location.href, { type: "svg", margin: 0, width: 96 }).then(setQr).catch(() => setQr(null));
  }, [code]);

  if (!data) return <p className="muted center" style={{ paddingTop: 80 }}>Checking certificate...</p>;
  if (!data.holder) {
    return (
      <main className="center" style={{ padding: "80px 16px" }}>
        <h1>Certificate not found</h1>
        <p className="muted">No certificate has the code {code.toUpperCase()}. Check the code and try again.</p>
      </main>
    );
  }
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 16px" }}>
      <div className="row no-print" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <span className={`pill ${data.valid ? "good" : "bad"}`}>{data.valid ? "Verified: this certificate is genuine" : "This certificate has been revoked"}</span>
        <button className="btn small" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
      <div className="card certificate" style={{ padding: "48px 40px", borderWidth: 3, borderColor: "var(--accent)", textAlign: "center" }}>
        <img src={logoSrc(data.branding)} alt="" width={64} height={64} style={{ objectFit: "contain" }} />
        <div className="muted" style={{ marginTop: 8, letterSpacing: "0.12em", textTransform: "uppercase", fontSize: "0.8rem" }}>
          {data.branding?.appName ?? "PlayCode"} · {data.institution}
        </div>
        <h1 style={{ fontSize: "2.2rem", margin: "24px 0 8px" }}>Certificate of achievement</h1>
        <p className="muted">This certifies that</p>
        <div style={{ fontSize: "1.8rem", fontWeight: 800, margin: "4px 0 12px" }}>{data.holder}</div>
        <p>
          cleared the <b>{data.title}</b> with a score of <b>{data.scorePct}%</b>
        </p>
        <p className="muted small">Issued {new Date(data.issuedAt!).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</p>
        <div className="spread" style={{ marginTop: 32, alignItems: "flex-end" }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ borderTop: "1px solid var(--text)", paddingTop: 4, minWidth: 200 }}>{data.branding?.certificateSignatory ?? "Training & Placement Office"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            {qr && <div aria-label="QR code linking to this verification page" dangerouslySetInnerHTML={{ __html: qr }} />}
            <div className="small muted" style={{ fontFamily: "var(--mono)" }}>
              {data.code}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
