import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, type TestApp } from "./helpers";

// A minimal OpenID provider: discovery, JWKS, and a token endpoint that hands
// back whatever identity the test queued for the next code.
let t: TestApp;
let admin: string;
let provider: Server;
let issuer: string;
let privateKey: CryptoKey;
let nextIdentity: Record<string, unknown> = {};
let lastTokenRequest: URLSearchParams | null = null;
const codes = new Map<string, string>(); // code -> nonce

beforeAll(async () => {
  t = await setup();
  admin = await t.login("admin@demo.edu");
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  provider = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const json = (data: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
      if (req.url === "/.well-known/openid-configuration") {
        return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
      }
      if (req.url === "/jwks") return json({ keys: [jwk] });
      if (req.url === "/token" && req.method === "POST") {
        lastTokenRequest = new URLSearchParams(body);
        const nonce = codes.get(lastTokenRequest.get("code") ?? "");
        if (!nonce || lastTokenRequest.get("client_secret") !== "s3cret") return res.writeHead(400).end();
        const iat = Math.floor(t.clock.now.getTime() / 1000);
        const idToken = await new SignJWT({ nonce, ...nextIdentity })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(issuer)
          .setAudience("playcode-client")
          .setSubject("subject-1")
          .setIssuedAt(iat)
          .setExpirationTime(iat + 300)
          .sign(privateKey);
        return json({ access_token: "x", id_token: idToken, token_type: "Bearer" });
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
});

afterAll(async () => {
  provider.close();
  await t.app.close();
  await pool.end();
});

/** Runs the whole redirect dance and returns where the callback sends the browser. */
async function signIn(identity: Record<string, unknown>, opts: { tamperState?: boolean; advanceMs?: number } = {}) {
  nextIdentity = identity;
  const start = await t.app.inject({ method: "GET", url: "/auth/sso/start?org=demo-tech" });
  expect(start.statusCode).toBe(302);
  const authorize = new URL(start.headers.location as string);
  expect(authorize.origin + authorize.pathname).toBe(`${issuer}/authorize`);
  const code = `code-${codes.size}`;
  codes.set(code, authorize.searchParams.get("nonce")!);
  let state = authorize.searchParams.get("state")!;
  if (opts.tamperState) state = state.slice(0, -4) + "AAAA";
  const saved = t.clock.now;
  if (opts.advanceMs) t.clock.now = new Date(saved.getTime() + opts.advanceMs);
  try {
    const cb = await t.app.inject({ method: "GET", url: `/auth/sso/callback?code=${code}&state=${encodeURIComponent(state)}` });
    expect(cb.statusCode).toBe(302);
    return { location: cb.headers.location as string, authorize };
  } finally {
    t.clock.now = saved;
  }
}

const tokenFrom = (location: string) => decodeURIComponent(location.split("#token=")[1] ?? "");
const errorFrom = (location: string) => new URL(location).searchParams.get("sso_error") ?? "";

describe("single sign-on", () => {
  it("is configured by an institution admin", async () => {
    expect((await t.get("", "/public/branding/demo-tech")).body.sso).toBeNull();
    const tpo = await t.login("tpo@demo.edu");
    const body = { provider: "oidc", issuer, clientId: "playcode-client", clientSecret: "s3cret", emailDomains: ["@demo.edu"], autoProvisionUnitId: null, enabled: true };
    expect((await t.put(tpo, "/console/sso", body)).status).toBe(403);
    expect((await t.put(admin, "/console/sso", { ...body, clientSecret: undefined })).status).toBe(400);
    expect((await t.put(admin, "/console/sso", body)).status).toBe(200);

    const read = (await t.get(admin, "/console/sso")).body;
    expect(read.connection).toMatchObject({ provider: "oidc", emailDomains: ["demo.edu"], enabled: true });
    expect(JSON.stringify(read)).not.toContain("s3cret");
    expect(read.redirectUri).toMatch(/\/auth\/sso\/callback$/);
    expect((await t.get("", "/public/branding/demo-tech")).body.sso).toEqual({ provider: "oidc" });

    // Saving again without a secret keeps the stored one.
    expect((await t.put(admin, "/console/sso", { ...body, clientSecret: undefined })).status).toBe(200);
  });

  it("signs in an existing student with PKCE", async () => {
    const { location, authorize } = await signIn({ email: "student@demo.edu", email_verified: true, name: "Aarav" });
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location).toContain("/sso#token=");
    // The provider received the PKCE verifier matching the challenge.
    const { createHash } = await import("node:crypto");
    const verifier = lastTokenRequest!.get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(authorize.searchParams.get("code_challenge"));

    const me = await t.get(tokenFrom(location), "/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("student@demo.edu");
  });

  it("rejects other domains, unverified emails and unknown users", async () => {
    expect(errorFrom((await signIn({ email: "someone@gmail.com", email_verified: true })).location)).toContain("@demo.edu");
    expect(errorFrom((await signIn({ email: "student@demo.edu", email_verified: false })).location)).toContain("verified");
    expect(errorFrom((await signIn({ email: "new.person@demo.edu", email_verified: true })).location)).toContain("no PlayCode account");
  });

  it("rejects tampered and expired sign-ins", async () => {
    expect(errorFrom((await signIn({ email: "student@demo.edu", email_verified: true }, { tamperState: true })).location)).toContain("invalid");
    expect(errorFrom((await signIn({ email: "student@demo.edu", email_verified: true }, { advanceMs: 11 * 60_000 })).location)).toContain("too long");
    const cancelled = await t.app.inject({ method: "GET", url: "/auth/sso/callback?error=access_denied" });
    expect(errorFrom(cancelled.headers.location as string)).toBe("access_denied");
  });

  it("creates accounts on first sign-in when auto-provisioning is on", async () => {
    const units = (await t.get(admin, "/console/org-units")).body.units as { id: string; name: string }[];
    const unit = units.find((u) => u.name === "CSE 2027 - A")!;
    expect((await t.put(admin, "/console/sso", { provider: "oidc", issuer, clientId: "playcode-client", emailDomains: ["demo.edu"], autoProvisionUnitId: unit.id, enabled: true })).status).toBe(200);
    const { location } = await signIn({ email: "New.Person@demo.edu", email_verified: true, name: "New Person" });
    const me = await t.get(tokenFrom(location), "/me");
    expect(me.body.user).toMatchObject({ email: "new.person@demo.edu", name: "New Person", roles: ["student"] });
    expect(me.body.home).toBe("play");
  });

  it("turns off cleanly", async () => {
    await t.put(admin, "/console/sso", { provider: "oidc", issuer, clientId: "playcode-client", emailDomains: ["demo.edu"], autoProvisionUnitId: null, enabled: false });
    expect((await t.app.inject({ method: "GET", url: "/auth/sso/start?org=demo-tech" })).statusCode).toBe(400);
    expect((await t.get("", "/public/branding/demo-tech")).body.sso).toBeNull();
  });
});
