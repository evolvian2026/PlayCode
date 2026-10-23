"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { disablePush } from "@/lib/push";
import { api, getToken, setToken } from "@/lib/api";
import { applyBranding } from "@/lib/branding";
import type { Me } from "@/lib/types";
import { LocaleProvider } from "@/lib/i18n";

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside AuthGate");
  return me;
}

export async function signOut() {
  // Stop push notifications to this device, then revoke its session on the server too, so the token is dead even if it was copied.
  await disablePush().catch(() => {});
  const res = await api<{ redirect?: string | null }>("/auth/logout", { body: {} }).catch(() => null);
  setToken(null);
  // SAML single logout: the identity provider ends its session, then sends the browser back to sign-in.
  window.location.href = res?.redirect ?? "/login";
}

/** Partner and platform admins: work inside another tenant, or return home (null). */
export async function switchTenant(tenantId: string | null) {
  const res = await api<{ token: string }>("/auth/switch-tenant", { body: { tenantId } });
  setToken(res.token);
  window.location.href = "/console";
}

/** Loads the signed-in user and sends them to the right app (console or player). */
export function AuthGate({ area, children }: { area: "play" | "console"; children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<Me>("/me")
      .then((m) => {
        applyBranding(m.branding);
        if (area === "play" && !m.permissions.includes("practice.play")) router.replace("/console");
        else if (area === "console" && m.home !== "console") router.replace("/play");
        else {
          // Until required two-factor is set up, staff can only reach the security page.
          if (area === "console" && m.mfaSetupRequired && window.location.pathname !== "/console/account") router.replace("/console/account");
          setMe(m);
        }
      })
      .catch(() => router.replace("/login"));
  }, [area, router]);

  if (!me) return <p className="muted center" style={{ paddingTop: 80 }}>Loading...</p>;
  // The student app follows the account's language; the console stays in English.
  return (
    <MeContext.Provider value={me}>
      <LocaleProvider locale={area === "play" ? (me.user.locale ?? "en") : "en"}>{children}</LocaleProvider>
    </MeContext.Provider>
  );
}
