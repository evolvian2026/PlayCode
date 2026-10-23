import { DOMParser } from "@xmldom/xmldom";
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from "@node-saml/node-saml";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { authSessions, samlConnections, samlRequests, tenants, type SamlSessionRef } from "../db/schema";
import { env } from "../env";
import { audit } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { signInByEmail } from "./sso";
import { assertPublicUrl } from "./webhooks";
import { hasFeature } from "./plan";

// SAML 2.0 single sign-on for institutions whose identity provider does not
// speak OpenID Connect (ADFS, Shibboleth, Okta, Google Workspace SAML apps).
// Service-provider initiated: we send an AuthnRequest by redirect and the IdP
// posts a signed response to our assertion consumer service. Signature, issuer,
// audience, time window and InResponseTo checks are done by node-saml.
//
// With a service-provider key pair configured (SAML_SP_PRIVATE_KEY and
// SAML_SP_CERT), PlayCode also signs its requests, publishes an encryption key
// so the IdP can encrypt assertions, and takes part in single logout: signing
// out of PlayCode ends the IdP session, and an IdP-initiated logout ends the
// PlayCode sessions it started.

const REQUEST_TTL_MS = 10 * 60_000;
const EMAIL_FORMAT = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";

const base = () => env.API_PUBLIC_URL.replace(/\/$/, "");
export const spEntityId = (slug: string) => `${base()}/auth/saml/${slug}`;
export const acsUrl = (slug: string) => `${base()}/auth/saml/${slug}/acs`;
export const sloCallbackUrl = (slug: string) => `${base()}/auth/saml/${slug}/slo`;

/** The service provider's key pair, from the environment (PEM; "\\n" escapes are accepted). */
export function spKeys(): { key: string; cert: string } | null {
  const pem = (v: string | undefined) => v?.replace(/\\n/g, "\n").trim();
  const key = pem(process.env.SAML_SP_PRIVATE_KEY);
  const cert = pem(process.env.SAML_SP_CERT);
  return key && cert ? { key, cert } : null;
}

type Connection = typeof samlConnections.$inferSelect;

/** Outstanding request ids in Postgres, so any API instance can accept the response, and each only once. */
function requestStore(db: Db): CacheProvider {
  return {
    async saveAsync(key, value) {
      await db.delete(samlRequests).where(lt(samlRequests.createdAt, new Date(Date.now() - REQUEST_TTL_MS)));
      const [row] = await db.insert(samlRequests).values({ id: key, value }).onConflictDoNothing().returning();
      return row ? { value, createdAt: row.createdAt.getTime() } : null;
    },
    async getAsync(key) {
      const [row] = await db.select().from(samlRequests).where(and(eq(samlRequests.id, key), gt(samlRequests.createdAt, new Date(Date.now() - REQUEST_TTL_MS))));
      return row?.value ?? null;
    },
    async removeAsync(key) {
      if (!key) return null;
      const [row] = await db.delete(samlRequests).where(eq(samlRequests.id, key)).returning();
      return row?.value ?? null;
    },
  };
}

function client(db: Db, conn: Connection, slug: string) {
  const keys = spKeys();
  return new SAML({
    ...(keys ? { privateKey: keys.key, decryptionPvk: keys.key, signatureAlgorithm: "sha256" as const } : {}),
    logoutUrl: conn.sloUrl ?? conn.ssoUrl,
    logoutCallbackUrl: sloCallbackUrl(slug),
    issuer: spEntityId(slug),
    callbackUrl: acsUrl(slug),
    entryPoint: conn.ssoUrl,
    idpIssuer: conn.idpEntityId,
    idpCert: conn.certificates,
    audience: spEntityId(slug),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    identifierFormat: conn.emailAttribute ? null : EMAIL_FORMAT,
    disableRequestedAuthnContext: true,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_TTL_MS,
    cacheProvider: requestStore(db),
    acceptedClockSkewMs: 120_000,
  });
}

/** Accept a certificate pasted with or without PEM armour; keep the base64 body. */
export function certBody(pem: string): string {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(body) || body.length < 200) throw badRequest("That does not look like an X.509 certificate");
  return body;
}

/** Read entity id, redirect SSO URL and signing certificates from IdP metadata XML. */
export function parseIdpMetadata(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const md = "urn:oasis:names:tc:SAML:2.0:metadata";
  const ds = "http://www.w3.org/2000/09/xmldsig#";
  const entity = doc.getElementsByTagNameNS(md, "EntityDescriptor")[0];
  const idp = doc.getElementsByTagNameNS(md, "IDPSSODescriptor")[0];
  if (!entity || !idp) throw badRequest("That is not SAML identity provider metadata");
  const sso = Array.from(idp.getElementsByTagNameNS(md, "SingleSignOnService")).find((e) => e.getAttribute("Binding") === "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect");
  if (!sso) throw badRequest("The metadata has no HTTP-Redirect single sign-on service");
  const certs = Array.from(idp.getElementsByTagNameNS(md, "KeyDescriptor"))
    .filter((k) => !k.getAttribute("use") || k.getAttribute("use") === "signing")
    .flatMap((k) => Array.from(k.getElementsByTagNameNS(ds, "X509Certificate")).map((c) => (c.textContent ?? "").replace(/\s+/g, "")))
    .filter(Boolean);
  if (certs.length === 0) throw badRequest("The metadata has no signing certificate");
  const slo = Array.from(idp.getElementsByTagNameNS(md, "SingleLogoutService")).find((e) => e.getAttribute("Binding") === "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect");
  return { idpEntityId: entity.getAttribute("entityID") ?? "", ssoUrl: sso.getAttribute("Location") ?? "", sloUrl: slo?.getAttribute("Location") ?? null, certificates: [...new Set(certs)] };
}

export async function getSamlConnection(db: Db, tenantId: string) {
  const [c] = await db.select().from(samlConnections).where(eq(samlConnections.tenantId, tenantId));
  return c ?? null;
}

export async function saveSamlConnection(
  db: Db,
  tenantId: string,
  actorId: string,
  input: { idpEntityId: string; ssoUrl: string; sloUrl: string | null; requireEncryption: boolean; certificates: string[]; emailAttribute: string | null; emailDomains: string[]; autoProvisionUnitId: string | null; enabled: boolean },
) {
  await assertPublicUrl(input.ssoUrl);
  if (input.sloUrl) await assertPublicUrl(input.sloUrl);
  if (input.requireEncryption && !spKeys()) throw badRequest("Encrypted assertions need PlayCode's SAML key pair, which this server doesn't have yet");
  const values = {
    ...input,
    certificates: input.certificates.map(certBody),
    emailAttribute: input.emailAttribute?.trim() || null,
    emailDomains: input.emailDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean),
  };
  await db.insert(samlConnections).values({ tenantId, ...values }).onConflictDoUpdate({ target: samlConnections.tenantId, set: values });
  await audit(db, { tenantId, actorId, action: "saml.save", data: { idp: values.idpEntityId, domains: values.emailDomains, enabled: values.enabled, slo: Boolean(values.sloUrl), encryption: values.requireEncryption } });
}

async function tenantBySlug(db: Db, slug: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase()));
  if (!tenant) throw notFound("Institution");
  return tenant;
}

/** Service-provider metadata for the institution's IdP admin. */
export async function spMetadata(db: Db, slug: string) {
  const tenant = await tenantBySlug(db, slug);
  const conn = (await getSamlConnection(db, tenant.id)) ?? {
    tenantId: tenant.id,
    idpEntityId: "",
    ssoUrl: "https://example.invalid",
    sloUrl: null,
    requireEncryption: false,
    certificates: [],
    emailAttribute: null,
    emailDomains: [],
    autoProvisionUnitId: null,
    enabled: false,
    createdAt: new Date(),
  };
  // With a key pair: an encryption key, a signing key and the single logout service.
  const keys = spKeys();
  return client(db, { ...conn, certificates: conn.certificates.length ? conn.certificates : ["placeholder"] }, tenant.slug).generateServiceProviderMetadata(keys?.cert ?? null, keys?.cert ?? null);
}

/** Step 1: redirect the browser to the IdP with a fresh AuthnRequest. */
export async function startSaml(db: Db, slug: string) {
  const tenant = await tenantBySlug(db, slug);
  const conn = await getSamlConnection(db, tenant.id);
  if (!conn?.enabled || !(await hasFeature(db, tenant.id, "saml"))) return null;
  return client(db, conn, tenant.slug).getAuthorizeUrlAsync("", undefined, {});
}

function emailFrom(profile: Profile, conn: Connection): string {
  const pick = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const raw = conn.emailAttribute ? pick(profile[conn.emailAttribute]) : profile.nameIDFormat === EMAIL_FORMAT || String(profile.nameID).includes("@") ? profile.nameID : (profile.email ?? profile.mail);
  return typeof raw === "string" ? raw : "";
}

/** Step 2: the IdP posts the signed response; verify it and sign the person in. */
export async function finishSaml(db: Db, slug: string, form: Record<string, string>, now: Date) {
  const tenant = await tenantBySlug(db, slug);
  const conn = await getSamlConnection(db, tenant.id);
  if (!conn?.enabled) throw badRequest("SAML sign-in is not set up for this institution");
  if (!form.SAMLResponse) throw badRequest("The identity provider did not send a response");
  if (conn.requireEncryption && !hasEncryptedAssertion(form.SAMLResponse)) throw forbidden("Your identity provider must encrypt the assertion for this institution");
  let profile: Profile | null;
  try {
    ({ profile } = await client(db, conn, tenant.slug).validatePostResponseAsync({ SAMLResponse: form.SAMLResponse }));
  } catch {
    throw forbidden("Could not verify your identity with the sign-in provider");
  }
  if (!profile) throw forbidden("Could not verify your identity with the sign-in provider");
  const email = emailFrom(profile, conn);
  if (!email.includes("@")) throw forbidden("Your identity provider did not send an email address");
  const name = [profile["givenName"], profile["sn"]].filter((x) => typeof x === "string").join(" ") || (typeof profile["displayName"] === "string" ? profile["displayName"] : null);
  const saml: SamlSessionRef = { tenantId: tenant.id, nameID: profile.nameID, nameIDFormat: profile.nameIDFormat, sessionIndex: profile.sessionIndex ?? null };
  return signInByEmail(db, { tenantId: tenant.id, email, name: name || null, emailDomains: conn.emailDomains, autoProvisionUnitId: conn.autoProvisionUnitId, via: "saml.login", saml }, now);
}

function hasEncryptedAssertion(samlResponse: string): boolean {
  const doc = new DOMParser().parseFromString(Buffer.from(samlResponse, "base64").toString("utf8"), "text/xml");
  const ns = "urn:oasis:names:tc:SAML:2.0:assertion";
  return doc.getElementsByTagNameNS(ns, "EncryptedAssertion").length > 0 && doc.getElementsByTagNameNS(ns, "Assertion").length === 0;
}

// ---------- Single logout ----------

/**
 * Signing out of PlayCode from a SAML session: where to send the browser so
 * the IdP ends its session too, or null when this institution doesn't use
 * single logout (or the server has no key to sign the request with).
 */
export async function samlLogoutUrl(db: Db, ref: SamlSessionRef | null): Promise<string | null> {
  if (!ref || !spKeys()) return null;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, ref.tenantId));
  const conn = tenant ? await getSamlConnection(db, tenant.id) : null;
  if (!tenant || !conn?.enabled || !conn.sloUrl) return null;
  const profile: Profile = { issuer: conn.idpEntityId, nameID: ref.nameID, nameIDFormat: ref.nameIDFormat, ...(ref.sessionIndex ? { sessionIndex: ref.sessionIndex } : {}) };
  return client(db, conn, tenant.slug).getLogoutUrlAsync(profile, "", {});
}

/** End the PlayCode sessions an IdP logout request names. */
async function endSessions(db: Db, tenantId: string, profile: Profile, now: Date) {
  const rows = await db
    .update(authSessions)
    .set({ revokedAt: now })
    .where(
      and(
        isNull(authSessions.revokedAt),
        sql`${authSessions.saml}->>'tenantId' = ${tenantId}`,
        sql`${authSessions.saml}->>'nameID' = ${profile.nameID}`,
        // A request for one IdP session ends only that session; without an index, all of them.
        profile.sessionIndex ? sql`${authSessions.saml}->>'sessionIndex' = ${profile.sessionIndex}` : undefined,
      ),
    )
    .returning({ id: authSessions.id, userId: authSessions.userId });
  if (rows.length) await audit(db, { tenantId, actorId: rows[0]!.userId, action: "saml.logout", data: { sessions: rows.length, initiatedBy: "idp" } });
  return rows.length;
}

/**
 * The single logout endpoint. The IdP sends either a LogoutRequest (it is
 * ending the person's sessions everywhere) or a LogoutResponse (answering ours).
 * Returns where to send the browser next.
 */
export async function handleSlo(db: Db, slug: string, input: { query: Record<string, string>; rawQuery: string; form: Record<string, string> | null }, now: Date): Promise<string> {
  const tenant = await tenantBySlug(db, slug);
  const conn = await getSamlConnection(db, tenant.id);
  const appLogin = `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/login?org=${encodeURIComponent(tenant.slug)}&signed_out=1`;
  if (!conn?.enabled) throw badRequest("SAML sign-in is not set up for this institution");
  const saml = client(db, conn, tenant.slug);
  const message = input.form ?? input.query;

  if (message.SAMLRequest) {
    // Unsigned logout requests are refused: anyone could otherwise sign people out.
    if (!input.form && !input.query.Signature) throw forbidden("The logout request is not signed");
    let profile: Profile | null;
    try {
      ({ profile } = input.form ? await saml.validatePostRequestAsync({ SAMLRequest: input.form.SAMLRequest! }) : await saml.validateRedirectAsync(input.query, input.rawQuery));
    } catch {
      throw forbidden("Could not verify the logout request");
    }
    if (!profile) throw forbidden("Could not verify the logout request");
    await endSessions(db, tenant.id, profile, now);
    return saml.getLogoutResponseUrlAsync(profile, message.RelayState ?? "", {}, true);
  }

  if (message.SAMLResponse) {
    // Our own session was already ended before the browser went to the IdP; this only checks the IdP answered our request.
    try {
      if (input.form) await saml.validatePostResponseAsync({ SAMLResponse: input.form.SAMLResponse! });
      else await saml.validateRedirectAsync(input.query, input.rawQuery);
    } catch {
      // Still signed out of PlayCode; the IdP session may live on, which the login page can't fix.
    }
    return appLogin;
  }
  throw badRequest("Expected a SAML logout request or response");
}
