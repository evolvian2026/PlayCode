import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
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

function response(o: { requestId: string; email: string; audience?: string; signer?: { key: string; cert: string }; tamper?: string }) {
  const now = new Date();
  const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const acs = "http://localhost:4000/auth/saml/demo-tech/acs";
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${iso(0)}" Destination="${acs}" InResponseTo="${o.requestId}"><saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_a${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${iso(0)}"><saml:Issuer>${IDP}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${o.email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${o.requestId}" NotOnOrAfter="${iso(300_000)}" Recipient="${acs}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(300_000)}"><saml:AudienceRestriction><saml:Audience>${o.audience ?? "http://localhost:4000/auth/saml/demo-tech"}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="displayName"><saml:AttributeValue>Saml Person</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
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

/** Start sign-in, then post the IdP's response. Returns PlayCode's redirect. */
async function signIn(email: string, opts: Parameters<typeof response>[0] extends infer P ? Partial<P> & { replay?: boolean } : never = {}) {
  const start = await t.app.inject({ method: "GET", url: "/auth/sso/start?org=demo-tech" });
  expect(start.statusCode).toBe(302);
  const url = new URL(start.headers.location as string);
  expect(url.origin + url.pathname).toBe(SSO_URL);
  const request = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
  const requestId = /ID="([^"]+)"/.exec(request)![1]!;
  const post = (saml: string) =>
    t.app.inject({ method: "POST", url: "/auth/saml/demo-tech/acs", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ SAMLResponse: saml }).toString() });
  const saml = response({ requestId, email, ...opts });
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
    expect(parsed).toEqual({ idpEntityId: IDP, ssoUrl: SSO_URL, certificates: [body(idp.cert)] });
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
