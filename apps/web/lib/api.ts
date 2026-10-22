"use client";

import { useCallback, useEffect, useState } from "react";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "playcode.token";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the session lasts until the tab closes.
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 401 && path !== "/auth/login") {
      setToken(null);
      if (typeof window !== "undefined") window.location.href = "/login";
    }
    throw new ApiError(res.status, err.code ?? "error", err.message ?? "Request failed", err.details);
  }
  return data as T;
}

/** Fetch an authenticated binary (e.g. a proctoring snapshot) as an object URL. */
export async function fetchObjectUrl(path: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, "error", "Could not load the file");
  return URL.createObjectURL(await res.blob());
}

/** Fetch on mount (and when `path` changes). Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "network", "Could not reach the server"));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Could not reach the server. Check your connection and try again.";
}
