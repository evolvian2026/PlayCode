"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "@/lib/api";
import type { Me } from "@/lib/types";

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside AuthGate");
  return me;
}

export function signOut() {
  setToken(null);
  window.location.href = "/login";
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
        if (area === "play" && !m.permissions.includes("practice.play")) router.replace("/console");
        else if (area === "console" && m.home !== "console") router.replace("/play");
        else setMe(m);
      })
      .catch(() => router.replace("/login"));
  }, [area, router]);

  if (!me) return <p className="muted center" style={{ paddingTop: 80 }}>Loading...</p>;
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}
