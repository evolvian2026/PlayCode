import { execFileSync } from "node:child_process";
import { createSign, createVerify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { SignedXml } from "xml-crypto";
import { encrypt } from "xml-encryption";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { authSessions } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

// A test identity provider: a self-signed certificate and SAML responses
// signed with xml-crypto, the way ADFS or Okta would send them.
let t: TestApp;
let admin: string;
let idp: { key: string; cert: string };
let rogue: { key: string; cert: string };
const IDP = "https://idp.demo.edu/saml";
const SSO_URL = "https://idp.demo.edu/sso";

function keypair(name: string) {
  const dir = mkdtempSync(join(tmpdir(), "playcode-saml-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "2", "-subj", `/CN=${name}`], { stdio: "ignore" });
  const out = { key: readFileSync(join(dir, "k.pem"), "utf8"), cert: readFileSync(join(dir, "c.pem"), "utf8") };
  rmSync(dir, { recursive: true, force: true });
  return out;
}

const body = (pem: string) => pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, "");

function response(o: { requestId: string; email: string; audience?: string; signer?: { key: string; cert: string }; tamper?: string; sessionIndex?: string }) {
  const now = new Date();
  const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const acs = "http://localhost:4000/auth/saml/demo-tech/acs";
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${iso(0)}" Destination="${acs}" InResponseTo="${o.requestId}"><saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${iso(0)}"><saml:Issuer>${IDP}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${o.email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${o.requestId}" NotOnOrAfter="${iso(300_000)}" Recipient="${acs}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(300_000)}"><saml:AudienceRestriction><saml:Audience>${o.audience ?? "http://localhost:4000/auth/saml/demo-tech"}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="${o.sessionIndex ?? "_s1"}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="displayName"><saml:AttributeValue>Saml Person</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
  const signer = o.signer ?? idp;
  const sig = new SignedXml({
    privateKey: signer.key,
    publicCert: signer.cert,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: "after" } });
  let signed = sig.getSignedXml();
  if (o.tamper) signed = signed.replace(o.email, o.tamper);
  return Buffer.from(signed).toString("base64");
}

/** Encrypt the (signed) assertion in a response to the given certificate, as an IdP does when the SP asks for it. */
async function encryptAssertion(samlResponse: string, cert: string) {
  const xml = Buffer.from(samlResponse, "base64").toString();
  const assertion = /<saml:Assertion[\s\S]*<\/saml:Assertion>/.exec(xml)![0];
  const encrypted = await new Promise<string>((resolve, reject) =>
    encrypt(
      assertion,
      {
        rsa_pub: cert,
        pem: cert,
        encryptionAlgorithm: "http://www.w3.org/2009/xmlenc11#aes256-gcm",
        keyEncryptionAlgorithm: "http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p",
        disallowEncryptionWithInsecureAlgorithm: true,
      },
      (err, out) => (err ? reject(err) : resolve(out)),
    ),
  );
  return Buffer.from(xml.replace(assertion, `<saml:EncryptedAssertion>${encrypted}</saml:EncryptedAssertion>`)).toString("base64");
}

const SIG_ALG = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

/** A message sent by HTTP-Redirect binding, signed over the query string as the binding requires. */
function redirectQuery(kind: "SAMLRequest" | "SAMLResponse", xml: string, signer?: { key: string }) {
  let q = `${kind}=${encodeURIComponent(deflateRawSync(Buffer.from(xml)).toString("base64"))}&RelayState=r1&SigAlg=${encodeURIComponent(SIG_ALG)}`;
  if (signer) q += `&Signature=${encodeURIComponent(createSign("RSA-SHA256").update(q).sign(signer.key, "base64"))}`;
  return q;
}

function idpLogoutRequest(o: { email: string; sessionIndex?: string }) {
  const now = Date.now();
  return `<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_lr${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${new Date(now).toISOString()}" NotOnOrAfter="${new Date(now + 300_000).toISOString()}" Destination="http://localhost:4000/auth/saml/demo-tech/slo"><saml:Issuer>${IDP}</saml:Issuer><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${o.email}</saml:NameID>${o.sessionIndex ? `<samlp:SessionIndex>${o.sessionIndex}</samlp:SessionIndex>` : ""}</samlp:LogoutRequest>`;
}

function idpLogoutResponse(inResponseTo: string) {
  return `<samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_lp${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${new Date().toISOString()}" InResponseTo="${inResponseTo}"><saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status></samlp:LogoutResponse>`;
}

/** Start sign-in, then post the IdP's response. Returns PlayCode's redirect. */
async function signIn(email: string, opts: Parameters<typeof response>[0] extends infer P ? Partial<P> & { replay?: boolean; encryptTo?: string } : never = {}) {
  const start = await t.app.inject({ method: "GET", url: "/auth/sso/start?org=demo-tech" });
  expect(start.statusCode).toBe(302);
  const url = new URL(start.headers.location as string);
  expect(url.origin + url.pathname).toBe(SSO_URL);
  const request = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
  const requestId = /ID="([^"]+)"/.exec(request)![1]!;
  const post = (saml: string) =>
    t.app.inject({ method: "POST", url: "/auth/saml/demo-tech/acs", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ SAMLResponse: saml }).toString() });
  const saml = opts.encryptTo ? await encryptAssertion(response({ requestId, email, ...opts }), opts.encryptTo) : response({ requestId, email, ...opts });
  let res = await post(saml);
  if (opts.replay) res = await post(saml);
  expect(res.statusCode).toBe(302);
  const location = res.headers.location as string;
  return { token: decodeURIComponent(location.split("#token=")[1] ?? ""), error: new URL(location).searchParams.get("sso_error"), request };
}

beforeAll(async () => {
  t = await setup();
  admin = await t.login("admin@demo.edu");
  idp = keypair("test-idp");
  rogue = keypair("rogue-idp");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("SAML 2.0", () => {
  it("imports IdP metadata and publishes SP metadata", async () => {
    const metadata = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${IDP}"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${body(idp.cert)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${SSO_URL}/post"/><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${SSO_URL}"/></IDPSSODescriptor></EntityDescriptor>`;
    const parsed = (await t.post(admin, "/console/saml/metadata", { xml: metadata })).body;
    expect(parsed).toEqual({ idpEntityId: IDP, ssoUrl: SSO_URL, sloUrl: null, certificates: [body(idp.cert)] });
    expect((await t.post(admin, "/console/saml/metadata", { xml: "<nope/>" })).status).toBe(400);

    const save = await t.put(admin, "/console/saml", { ...parsed, certificates: [idp.cert], emailAttribute: null, emailDomains: ["demo.edu"], autoProvisionUnitId: null, enabled: true });
    expect(save.status).toBe(200);
    const cfg = (await t.get(admin, "/console/saml")).body;
    expect(cfg.sp.acsUrl).toBe("http://localhost:4000/auth/saml/demo-tech/acs");
    expect(cfg.connection.certificates[0]).toBe(body(idp.cert));
    expect((await t.get("", "/public/branding/demo-tech")).body.sso).toEqual({ provider: "saml" });

    const sp = await t.app.inject({ method: "GET", url: "/auth/saml/demo-tech/metadata" });
    expect(sp.headers["content-type"]).toContain("samlmetadata+xml");
    expect(sp.body).toContain('entityID="http://localhost:4000/auth/saml/demo-tech"');
    expect(sp.body).toContain('Location="http://localhost:4000/auth/saml/demo-tech/acs"');
  });

  it("signs in a person from a signed assertion", async () => {
    const r = await signIn("student@demo.edu");
    expect(r.error).toBeNull();
    expect(r.request).toContain('AssertionConsumerServiceURL="http://localhost:4000/auth/saml/demo-tech/acs"');
    expect((await t.get(r.token, "/me")).body.user.email).toBe("student@demo.edu");
  });

  it("rejects replays, tampering, the wrong signer and the wrong audience", async () => {
    expect((await signIn("student@demo.edu", { replay: true })).error).toContain("Could not verify");
    expect((await signIn("student@demo.edu", { tamper: "tpo@demo.edu" })).error).toContain("Could not verify");
    expect((await signIn("student@demo.edu", { signer: rogue })).error).toContain("Could not verify");
    expect((await signIn("student@demo.edu", { audience: "https://someone-else.example/sp" })).error).toContain("Could not verify");
    expect((await signIn("someone@gmail.com")).error).toContain("@demo.edu");
  });

  it("creates accounts when the institution allows it", async () => {
    expect((await signIn("new.saml@demo.edu")).error).toContain("no PlayCode account");
    const units = (await t.get(admin, "/console/org-units")).body.units as { id: string; name: string }[];
    const cfg = (await t.get(admin, "/console/saml")).body.connection;
    await t.put(admin, "/console/saml", { ...cfg, createdAt: undefined, autoProvisionUnitId: units.find((u) => u.name === "CSE 2027 - B")!.id });
    const r = await signIn("new.saml@demo.edu");
    expect((await t.get(r.token, "/me")).body.user).toMatchObject({ email: "new.saml@demo.edu", name: "Saml Person", roles: ["student"] });
  });
});

describe("SAML single logout and encrypted assertions", () => {
  const SLO_URL = "https://idp.demo.edu/slo";
  let sp: { key: string; cert: string };

  beforeAll(async () => {
    sp = keypair("playcode-sp");
    process.env.SAML_SP_PRIVATE_KEY = sp.key.replace(/\n/g, "\\n"); // as it would sit in a .env file
    process.env.SAML_SP_CERT = sp.cert;
    const metadata = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${IDP}"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${body(idp.cert)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></KeyDescriptor><SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${SLO_URL}"/><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${SSO_URL}"/></IDPSSODescriptor></EntityDescriptor>`;
    const parsed = (await t.post(admin, "/console/saml/metadata", { xml: metadata })).body;
    expect(parsed.sloUrl).toBe(SLO_URL);
    const cfg = (await t.get(admin, "/console/saml")).body.connection;
    expect((await t.put(admin, "/console/saml", { ...cfg, createdAt: undefined, sloUrl: parsed.sloUrl, autoProvisionUnitId: null })).status).toBe(200);
  });

  afterAll(() => {
    delete process.env.SAML_SP_PRIVATE_KEY;
    delete process.env.SAML_SP_CERT;
  });

  it("publishes PlayCode's signing and encryption key and logout service", async () => {
    const md = (await t.app.inject({ method: "GET", url: "/auth/saml/demo-tech/metadata" })).body;
    expect(md).toContain('use="encryption"');
    expect(md).toContain('use="signing"');
    expect(md.replace(/\s/g, "")).toContain(body(sp.cert));
    expect(md).toContain('Location="http://localhost:4000/auth/saml/demo-tech/slo"');
    expect((await t.get(admin, "/console/saml")).body.sp).toMatchObject({ hasKeys: true, sloUrl: "http://localhost:4000/auth/saml/demo-tech/slo" });
  });

  it("signs out of the IdP too when a SAML session signs out", async () => {
    const { token } = await signIn("student@demo.edu", { sessionIndex: "_idp-a" });
    const out = await t.post(token, "/auth/logout", {});
    expect((await t.get(token, "/me")).status).toBe(401);
    const url = new URL(out.body.redirect);
    expect(url.origin + url.pathname).toBe(SLO_URL);
    const request = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
    expect(request).toContain("LogoutRequest");
    expect(request).toContain(">student@demo.edu<");
    expect(request).toContain(">_idp-a<");
    // The request is signed with PlayCode's key (HTTP-Redirect binding).
    const signedPart = url.search.slice(1).split("&Signature=")[0]!;
    expect(createVerify("RSA-SHA256").update(signedPart).verify(sp.cert, url.searchParams.get("Signature")!, "base64")).toBe(true);
    // The IdP answers; the browser lands on the sign-in page.
    const requestId = /ID="([^"]+)"/.exec(request)![1]!;
    const back = await t.app.inject({ method: "GET", url: `/auth/saml/demo-tech/slo?${redirectQuery("SAMLResponse", idpLogoutResponse(requestId), idp)}` });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe("http://localhost:3000/login?org=demo-tech&signed_out=1");
    // Other sign-ins have nothing to do at the IdP.
    const pw = await t.login("tpo@demo.edu");
    expect((await t.post(pw, "/auth/logout", {})).body.redirect).toBeNull();
  });

  it("ends the matching PlayCode session when the IdP signs the person out", async () => {
    const a = (await signIn("student@demo.edu", { sessionIndex: "_idp-1" })).token;
    const b = (await signIn("student@demo.edu", { sessionIndex: "_idp-2" })).token;
    const slo = (query: string) => t.app.inject({ method: "GET", url: `/auth/saml/demo-tech/slo?${query}` });

    // Unsigned, or signed by someone else: refused, nobody is signed out.
    let res = await slo(redirectQuery("SAMLRequest", idpLogoutRequest({ email: "student@demo.edu", sessionIndex: "_idp-1" })));
    expect(new URL(res.headers.location as string).searchParams.get("sso_error")).toContain("not signed");
    res = await slo(redirectQuery("SAMLRequest", idpLogoutRequest({ email: "student@demo.edu", sessionIndex: "_idp-1" }), rogue));
    expect(new URL(res.headers.location as string).searchParams.get("sso_error")).toContain("Could not verify");
    expect((await t.get(a, "/me")).status).toBe(200);

    res = await slo(redirectQuery("SAMLRequest", idpLogoutRequest({ email: "student@demo.edu", sessionIndex: "_idp-1" }), idp));
    const answer = new URL(res.headers.location as string);
    expect(answer.origin + answer.pathname).toBe(SLO_URL);
    expect(answer.searchParams.get("RelayState")).toBe("r1");
    expect(inflateRawSync(Buffer.from(answer.searchParams.get("SAMLResponse")!, "base64")).toString()).toContain("status:Success");
    expect((await t.get(a, "/me")).status).toBe(401);
    expect((await t.get(b, "/me")).status).toBe(200);

    // Without a session index, every SAML session of that person ends.
    await slo(redirectQuery("SAMLRequest", idpLogoutRequest({ email: "student@demo.edu" }), idp));
    expect((await t.get(b, "/me")).status).toBe(401);
    const ended = (await db.select().from(authSessions).where(eq(authSessions.method, "saml"))).filter((s) => s.saml?.nameID === "student@demo.edu");
    expect(ended.length).toBeGreaterThan(2);
    expect(ended.every((s) => s.revokedAt)).toBe(true);
  });

  it("accepts encrypted assertions, and can require them", async () => {
    const enc = await signIn("student@demo.edu", { encryptTo: sp.cert });
    expect(enc.error).toBeNull();
    expect((await t.get(enc.token, "/me")).body.user.email).toBe("student@demo.edu");
    const cfg = (await t.get(admin, "/console/saml")).body.connection;
    await t.put(admin, "/console/saml", { ...cfg, createdAt: undefined, requireEncryption: true });
    expect((await signIn("student@demo.edu")).error).toContain("must encrypt");
    expect((await signIn("student@demo.edu", { encryptTo: sp.cert })).error).toBeNull();
    // Encrypted to the wrong key: can't be read.
    expect((await signIn("student@demo.edu", { encryptTo: rogue.cert })).error).toContain("Could not verify");
    // Without PlayCode's key pair the setting can't be turned on.
    await t.put(admin, "/console/saml", { ...cfg, createdAt: undefined, requireEncryption: false });
    const key = process.env.SAML_SP_PRIVATE_KEY;
    delete process.env.SAML_SP_PRIVATE_KEY;
    expect((await t.put(admin, "/console/saml", { ...cfg, createdAt: undefined, requireEncryption: true })).status).toBe(400);
    process.env.SAML_SP_PRIVATE_KEY = key;
  });
});
