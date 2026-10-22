"use client";

import { useEffect, useRef } from "react";
import { API_URL, getToken } from "./api";

export interface LiveEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Subscribe to live events from the API. Reconnects with backoff; pages that
 * depend on it also poll, so a dropped socket only makes updates slower.
 */
export function useLiveEvents(onEvent: (e: LiveEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const token = getToken();
      if (!token || closed) return;
      socket = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`);
      socket.onopen = () => (retry = 1000);
      socket.onmessage = (m) => {
        try {
          handler.current(JSON.parse(String(m.data)) as LiveEvent);
        } catch {
          // Ignore malformed messages.
        }
      };
      socket.onclose = (e) => {
        if (closed || e.code === 4401) return;
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30_000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);
}
