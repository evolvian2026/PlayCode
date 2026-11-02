// The Content Security Policy, built per request so each page gets its own
// nonce. Scripts run only if they carry it (Next adds it to its own
// bootstrap and chunks); 'strict-dynamic' lets those load the rest of the
// app. Styles still allow inline: React's style attributes need it, and a
// style can't run code. Network calls go only to this site and the API.

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const apiWs = api.replace(/^http/, "ws");

export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV !== "production"): string {
  return [
    "default-src 'self'",
    // 'self' is ignored where 'strict-dynamic' is understood, and kept for older browsers.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api}`,
    "font-src 'self' data:",
    `connect-src 'self' ${api} ${apiWs}`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
