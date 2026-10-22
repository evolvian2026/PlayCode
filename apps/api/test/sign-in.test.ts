import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setMailer, type Mail } from "../src/lib/mailer";
import { base32Encode, totpAt, totpStep } from "../src/lib/totp";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
const mails: Mail[] = [];

const login = (email: string, password = "playcode123") => t.post("", "/auth/login", { email, password });

beforeAll(async () => {
  t = await setup();
  setMailer({ send: async (m) => void mails.push(m) });
});

afterAll(async () => {
  setMailer(undefined);
  await t.app.close();
  await pool.end();
});

describe("TOTP", () => {
  it("matches the RFC 6238 test vector", () => {
    // SHA-1 secret "12345678901234567890" at T=59s gives 94287082; we use the last 6 digits.
    expect(totpAt(base32Encode(Buffer.from("12345678901234567890")), Math.floor(59 / 30))).toBe("287082");
  });
});

describe("sessions", () => {
  it("lists devices and signs them out", async () => {
    const laptop = (await login("faculty@demo.edu")).body.token;
    const phone = (await login("faculty@demo.edu")).body.token;
    const list = (await t.get(laptop, "/auth/sessions")).body.sessions as { id: string; current: boolean; method: string }[];
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);

    expect((await t.post(laptop, "/auth/sessions/revoke-others", {})).body.revoked).toBeGreaterThanOrEqual(1);
    const signedOut = await t.get(phone, "/me");
    expect(signedOut.status).toBe(401);
    expect(signedOut.body.error.message).toContain("signed out on this device");
    expect((await t.get(laptop, "/me")).status).toBe(200);

    await t.post(laptop, "/auth/logout", {});
    expect((await t.get(laptop, "/me")).status).toBe(401);
  });
});

describe("two-factor sign-in", () => {
  let secret: string;
  let recovery: string[];
  let adminToken: string;

  it("is set up with an authenticator app", async () => {
    const token = await t.login("hod.cse@demo.edu");
    const setupRes = (await t.post(token, "/auth/2fa/setup", {})).body;
    secret = setupRes.secret;
    expect(setupRes.otpauthUrl).toContain("otpauth://totp/PlayCode:hod.cse%40demo.edu");
    expect((await t.post(token, "/auth/2fa/enable", { code: "000000" })).status).toBe(400);
    const step = totpStep(t.clock.now);
    const on = await t.post(token, "/auth/2fa/enable", { code: totpAt(secret, step) });
    expect(on.status).toBe(200);
    recovery = on.body.recoveryCodes;
    expect(recovery).toHaveLength(8);
    expect((await t.get(token, "/auth/2fa")).body).toMatchObject({ enabled: true, recoveryCodesLeft: 8 });
  });

  it("asks for the code after the password", async () => {
    const first = (await login("hod.cse@demo.edu")).body;
    expect(first).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    expect((await t.get(first.mfaToken, "/me")).status).toBe(401); // the ticket is not a session
    expect((await t.post("", "/auth/login/2fa", { mfaToken: first.mfaToken, code: "123456" })).status).toBe(401);
    // The code used to enable two-factor can't be replayed; the next one works.
    const step = totpStep(t.clock.now);
    expect((await t.post("", "/auth/login/2fa", { mfaToken: first.mfaToken, code: totpAt(secret, step) })).status).toBe(401);
    const ok = await t.post("", "/auth/login/2fa", { mfaToken: first.mfaToken, code: totpAt(secret, step + 1) });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe("hod.cse@demo.edu");
  });

  it("accepts each recovery code once", async () => {
    const ticket = (await login("hod.cse@demo.edu")).body.mfaToken;
    expect((await t.post("", "/auth/login/2fa", { mfaToken: ticket, code: recovery[0] })).status).toBe(200);
    const again = (await login("hod.cse@demo.edu")).body.mfaToken;
    expect((await t.post("", "/auth/login/2fa", { mfaToken: again, code: recovery[0] })).status).toBe(401);
  });

  it("can be required for all staff by the institution", async () => {
    const admin = await t.login("admin@demo.edu");
    expect((await t.put(admin, "/console/security", { requireStaffMfa: true })).body.error.message).toContain("for yourself first");
    const adminSecret = (await t.post(admin, "/auth/2fa/setup", {})).body.secret;
    await t.post(admin, "/auth/2fa/enable", { code: totpAt(adminSecret, totpStep(t.clock.now)) });
    expect((await t.put(admin, "/console/security", { requireStaffMfa: true })).status).toBe(200);
    adminToken = admin;
    const tpo = await t.login("tpo@demo.edu");
    const blocked = await t.get(tpo, "/console/students");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("mfa_setup_required");
    expect((await t.get(tpo, "/me")).status).toBe(200);
    expect((await t.get(tpo, "/auth/2fa")).body).toMatchObject({ enabled: false, required: true });
    expect((await t.post(tpo, "/auth/2fa/setup", {})).status).toBe(200);
    // Students are not affected.
    expect((await t.get(await t.login("student@demo.edu"), "/student/home")).status).toBe(200);
    const sec = (await t.get(admin, "/console/security")).body;
    expect(sec).toMatchObject({ requireStaffMfa: true, staffWithTwoFactor: 2 }); // the HOD and the admin
    await t.put(admin, "/console/security", { requireStaffMfa: false });
  });

  it("can be reset by an admin when a phone is lost", async () => {
    const admin = adminToken; // signed in before two-factor was required
    const me = (await t.post("", "/auth/login/2fa", { mfaToken: (await login("hod.cse@demo.edu")).body.mfaToken, code: recovery[1] })).body;
    const res = await t.post(admin, `/console/users/${me.user.id}/reset-2fa`, {});
    expect(res.status).toBe(200);
    expect((await t.get(me.token, "/me")).status).toBe(401); // signed out everywhere
    expect((await login("hod.cse@demo.edu")).body.token).toBeTruthy(); // password alone again
  });
});

describe("sign-in codes", () => {
  it("signs in with a code sent by email, once", async () => {
    expect((await t.post("", "/auth/otp/request", { email: "nobody@demo.edu" })).body).toEqual({ sent: true });
    expect(mails).toHaveLength(0);
    await t.post("", "/auth/otp/request", { email: "student@demo.edu" });
    expect(mails).toHaveLength(1);
    const code = /(\d{6}) is your PlayCode sign-in code/.exec(mails[0]!.subject)![1]!;
    expect(mails[0]!.to).toBe("student@demo.edu");
    expect((await t.post("", "/auth/otp/verify", { email: "student@demo.edu", code: code === "000000" ? "111111" : "000000" })).status).toBe(401);
    const ok = await t.post("", "/auth/otp/verify", { email: "student@demo.edu", code });
    expect(ok.status).toBe(200);
    expect((await t.get(ok.body.token, "/auth/sessions")).body.sessions.find((s: { current: boolean }) => s.current).method).toBe("otp");
    expect((await t.post("", "/auth/otp/verify", { email: "student@demo.edu", code })).status).toBe(401);
  });

  it("locks a code after five wrong tries", async () => {
    mails.length = 0;
    await t.post("", "/auth/otp/request", { email: "faculty@demo.edu" });
    const code = /(\d{6})/.exec(mails[0]!.subject)![1]!;
    const wrong = code === "999999" ? "888888" : "999999";
    for (let i = 0; i < 5; i++) await t.post("", "/auth/otp/verify", { email: "faculty@demo.edu", code: wrong });
    expect((await t.post("", "/auth/otp/verify", { email: "faculty@demo.edu", code })).status).toBe(401);
  });
});
