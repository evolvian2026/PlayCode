"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage, setToken } from "@/lib/api";
import type { Me } from "@/lib/types";

// Single sign-on and LMS launches land here with our session token in the URL
// fragment (#token=...&next=...), which the browser never sends to any server.

/** Only same-site paths, so a crafted link can't bounce the user elsewhere. */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : null);
export default function SsoComplete() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("token");
    const next = safeNext(fragment.get("next"));
    window.history.replaceState(null, "", "/sso");
    if (!token) {
      router.replace("/login");
      return;
    }
    setToken(token);
    api<Me>("/me")
      .then((me) => router.replace(next ?? (me.home === "console" ? "/console" : "/play")))
      .catch((err) => {
        setToken(null);
        setError(errorMessage(err));
      });
  }, [router]);

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "64px 16px" }}>
      {error ? (
        <div className="card stack">
          <div className="error" role="alert">{error}</div>
          <a className="btn" href="/login">Back to sign in</a>
        </div>
      ) : (
        <p className="muted">Signing you in...</p>
      )}
    </main>
  );
}
