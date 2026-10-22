import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "../env";
import type { Db } from "../db/client";
import { memberships, ssoConnections, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { signToken } from "../lib/auth";
import { decrypt, encrypt } from "../lib/crypto";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors";
import { importStudents } from "./students";
import { assertPublicUrl } from "./webhooks";
import { hasFeature } from "./plan";

// OpenID Connect sign-in (Google Workspace, Microsoft Entra ID, or any OIDC
// provider), authorization-code flow with PKCE. The login state (nonce, PKCE
// verifier, tenant) travels encrypted inside the `state` parameter, so no
// server-side session store is needed and it works across API instances.

export const PRESET_ISSUERS = {
  google: "https://accounts.google.com",
  // Microsoft needs the organisation's directory (tenant) id in the issuer.
  microsoft: "https://login.microsoftonline.com/{tenant-id}/v2.0",
} as const;

const STATE_TTL_MS = 10 * 60_000;

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const discoveryCache = new Map<string, { doc: Discovery; jwks: JWTVerifyGetKey; at: number }>();

async function discover(issuer: string) {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < 3600_000) return cached;
  await assertPublicUrl(issuer);
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new HttpError(502, "sso_discovery", "Could not reach the sign-in provider");
  const doc = (await res.json()) as Discovery;
  const entry = { doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)), at: Date.now() };
  discoveryCache.set(issuer, entry);
  return entry;
}

export const redirectUri = () => `${env.API_PUBLIC_URL.replace(/\/$/, "")}/auth/sso/callback`;

const b64url = (buf: Buffer) => buf.toString("base64url");

export async function getConnection(db: Db, tenantId: string) {
  const [c] = await db.select().from(ssoConnections).where(eq(ssoConnections.tenantId, tenantId));
  return c ?? null;
}

export async function saveConnection(
  db: Db,
  tenantId: string,
  actorId: string,
  input: { provider: "google" | "microsoft" | "oidc"; issuer: string; clientId: string; clientSecret?: string; emailDomains: string[]; autoProvisionUnitId: string | null; enabled: boolean },
) {
  await assertPublicUrl(input.issuer);
  const existing = await getConnection(db, tenantId);
  if (!existing && !input.clientSecret) throw badRequest("Enter the client secret");
  const values = {
    provider: input.provider,
    issuer: input.issuer.replace(/\/$/, ""),
    clientId: input.clientId,
    clientSecretEnc: input.clientSecret ? encrypt(input.clientSecret) : existing!.clientSecretEnc,
    emailDomains: input.emailDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean),
    autoProvisionUnitId: input.autoProvisionUnitId,
    enabled: input.enabled,
  };
  await db.insert(ssoConnections).values({ tenantId, ...values }).onConflictDoUpdate({ target: ssoConnections.tenantId, set: values });
  await audit(db, { tenantId, actorId, action: "sso.save", data: { provider: input.provider, issuer: values.issuer, domains: values.emailDomains } });
  discoveryCache.delete(values.issuer);
}

/** Step 1: build the provider's authorization URL for a tenant (by slug). */
export async function startLogin(db: Db, slug: string, now: Date) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase()));
  if (!tenant) throw notFound("Institution");
  const conn = await getConnection(db, tenant.id);
  if (!conn?.enabled || !(await hasFeature(db, tenant.id, "sso"))) throw badRequest("Single sign-on is not set up for this institution");
  const { doc } = await discover(conn.issuer);
  const verifier = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(16));
  const state = encrypt(JSON.stringify({ t: tenant.id, n: nonce, v: verifier, exp: now.getTime() + STATE_TTL_MS }));
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: conn.clientId,
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

/** Step 2: the provider redirects back with a code. Returns our own session token. */
export async function finishLogin(db: Db, params: { code: string; state: string }, now: Date) {
  let st: { t: string; n: string; v: string; exp: number };
  try {
    st = JSON.parse(decrypt(params.state));
  } catch {
    throw badRequest("The sign-in link is invalid. Start again.");
  }
  if (now.getTime() > st.exp) throw badRequest("The sign-in took too long. Start again.");
  const conn = await getConnection(db, st.t);
  if (!conn?.enabled) throw badRequest("Single sign-on is not set up for this institution");
  const { doc, jwks } = await discover(conn.issuer);

  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: redirectUri(),
      client_id: conn.clientId,
      client_secret: decrypt(conn.clientSecretEnc),
      code_verifier: st.v,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new HttpError(502, "sso_token", "The sign-in provider rejected the request");
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new HttpError(502, "sso_token", "The sign-in provider did not return an identity");

  const { payload } = await jwtVerify(id_token, jwks, { audience: conn.clientId, currentDate: now }).catch(() => {
    throw forbidden("Could not verify your identity with the sign-in provider");
  });
  // Microsoft's common metadata has a {tenantid} placeholder in the issuer; fill it from the token.
  const expectedIssuer = doc.issuer.replace("{tenantid}", String(payload.tid ?? ""));
  if (payload.iss !== expectedIssuer || payload.nonce !== st.n) throw forbidden("Could not verify your identity with the sign-in provider");
  const email = String(payload.email ?? payload.preferred_username ?? "").toLowerCase();
  // Google sends email_verified; Microsoft work accounts are verified by the directory.
  if (!email || payload.email_verified === false) throw forbidden("Your account has no verified email address");
  return signInByEmail(db, { tenantId: st.t, email, name: payload.name ? String(payload.name) : null, emailDomains: conn.emailDomains, autoProvisionUnitId: conn.autoProvisionUnitId, via: "sso.login" }, now);
}

/**
 * The account rules every single sign-on method shares (OpenID Connect, SAML):
 * the email must be on an allowed domain and belong to this institution; new
 * people get a student account only if the institution chose a batch for them.
 */
export async function signInByEmail(
  db: Db,
  args: { tenantId: string; email: string; name: string | null; emailDomains: string[]; autoProvisionUnitId: string | null; via: string },
  now: Date,
) {
  const email = args.email.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!args.emailDomains.includes(domain)) throw forbidden(`Sign in with your ${args.emailDomains.map((d) => `@${d}`).join(" or ")} account`);

  let [user] = await db.select().from(users).where(eq(users.email, email));
  if (user && user.tenantId !== args.tenantId) throw forbidden("This email belongs to another institution");
  if (!user) {
    if (!args.autoProvisionUnitId) throw forbidden("There is no PlayCode account for this email. Ask your institution to add you.");
    const created = await importStudents(db, { tenantId: args.tenantId, actorId: null, unitId: args.autoProvisionUnitId, rows: [{ name: args.name ?? email.split("@")[0]!, email, rollNo: null, phone: null }], now });
    [user] = await db.select().from(users).where(eq(users.id, created.created[0]!.id));
  }
  if (user!.status !== "active") throw forbidden("Your account is disabled");
  const roles = [...new Set((await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, user!.id))).map((r) => r.role))];
  await audit(db, { tenantId: args.tenantId, actorId: user!.id, action: args.via, data: { email } });
  return signToken({ sub: user!.id, tenantId: user!.tenantId, roles });
}
