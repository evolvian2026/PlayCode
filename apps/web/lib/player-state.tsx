"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { ProfileSummary } from "./types";

// The student header (XP, streak, hearts) is shared across pages and updated
// live from answer results, without refetching.
interface PlayerState {
  profile: ProfileSummary | null;
  setProfile: (p: ProfileSummary) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PlayerState>({ profile: null, setProfile: () => {}, refresh: async () => {} });

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const refresh = useCallback(async () => {
    const home = await api<{ profile: ProfileSummary }>("/student/home");
    setProfile(home.profile);
  }, []);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);
  return <Ctx.Provider value={{ profile, setProfile, refresh }}>{children}</Ctx.Provider>;
}

export const usePlayer = () => useContext(Ctx);
