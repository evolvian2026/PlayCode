"use client";

import { API_URL } from "./api";
import type { Branding } from "./types";

/** Apply an institution's colour and name to the whole app. */
export function applyBranding(b: Pick<Branding, "appName" | "primaryColor"> | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (b?.primaryColor) root.style.setProperty("--accent", b.primaryColor);
  else root.style.removeProperty("--accent");
  document.title = b?.appName ?? "PlayCode";
}

export const logoSrc = (b: Pick<Branding, "logoUrl"> | null | undefined) => (b?.logoUrl ? `${API_URL}${b.logoUrl}` : "/icon.svg");
