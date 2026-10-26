"use client";

import { useEffect } from "react";

/** Registers the service worker on every page, so the offline practice page is ready before the signal goes. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
