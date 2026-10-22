import { DOMParser } from "@xmldom/xmldom";
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from "@node-saml/node-saml";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { samlConnections, samlRequests, tenants } from "../db/schema";
import { env } from "../env";
import { audit } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { signInByEmail } from "./sso";
import { assertPublicUrl } from "./webhooks";

// SAML 2.0 single sign-on for institutions whose identity provider does not
// speak OpenID Connect (ADFS, Shibboleth, Okta, Google Workspace SAML apps).
// Service-provider initiated: we send an AuthnRequest by redirect and the IdP
// posts a signed response to our assertion consumer service. Signature, issuer,
// audience, time window and InResponseTo checks are done by node-saml.

const REQUEST_TTL_MS = 10 * 60_000;
const EMAIL_FORMAT = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";

const base = () => env.API_PUBLIC_URL.replace(/\/$/, "");
export const spEntityId = (slug: string) => `${base()}/auth/saml/${slug}`;
export const acsUrl = (slug: string) => `${base()}/auth/saml/${slug}/acs`;

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
  return new SAML({
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
  return { idpEntityId: entity.getAttribute("entityID") ?? "", ssoUrl: sso.getAttribute("Location") ?? "", certificates: [...new Set(certs)] };
}

export async function getSamlConnection(db: Db, tenantId: string) {
  const [c] = await db.select().from(samlConnections).where(eq(samlConnections.tenantId, tenantId));
  return c ?? null;
}

export async function saveSamlConnection(
  db: Db,
  tenantId: string,
  actorId: string,
  input: { idpEntityId: string; ssoUrl: string; certificates: string[]; emailAttribute: string | null; emailDomains: string[]; autoProvisionUnitId: string | null; enabled: boolean },
) {
  await assertPublicUrl(input.ssoUrl);
  const values = {
    ...input,
    certificates: input.certificates.map(certBody),
    emailAttribute: input.emailAttribute?.trim() || null,
    emailDomains: input.emailDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean),
  };
  await db.insert(samlConnections).values({ tenantId, ...values }).onConflictDoUpdate({ target: samlConnections.tenantId, set: values });
  await audit(db, { tenantId, actorId, action: "saml.save", data: { idp: values.idpEntityId, domains: values.emailDomains, enabled: values.enabled } });
}

async function tenantBySlug(db: Db, slug: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase()));
  if (!tenant) throw notFound("Institution");
  return tenant;
}

/** Service-provider metadata for the institution's IdP admin. */
export async function spMetadata(db: Db, slug: string) {
  const tenant = await tenantBySlug(db, slug);
  const conn = (await getSamlConnection(db, tenant.id)) ?? { tenantId: tenant.id, idpEntityId: "", ssoUrl: "https://example.invalid", certificates: [], emailAttribute: null, emailDomains: [], autoProvisionUnitId: null, enabled: false, createdAt: new Date() };
  return client(db, { ...conn, certificates: conn.certificates.length ? conn.certificates : ["placeholder"] }, tenant.slug).generateServiceProviderMetadata(null, null);
}

/** Step 1: redirect the browser to the IdP with a fresh AuthnRequest. */
export async function startSaml(db: Db, slug: string) {
  const tenant = await tenantBySlug(db, slug);
  const conn = await getSamlConnection(db, tenant.id);
  if (!conn?.enabled) return null;
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
  return signInByEmail(db, { tenantId: tenant.id, email, name: name || null, emailDomains: conn.emailDomains, autoProvisionUnitId: conn.autoProvisionUnitId, via: "saml.login" }, now);
}
