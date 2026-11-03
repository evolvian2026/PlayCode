import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { loginCodes, users } from "../db/schema";
import { env } from "../env";
import { audit } from "../lib/audit";
import { decrypt, encrypt, randomToken, safeEqual, sha256 } from "../lib/crypto";
import { badRequest, unauthorized } from "../lib/errors";
import { mailer } from "../lib/mailer";
import { newTotpSecret, otpauthUrl, verifyTotp } from "../lib/totp";
import { sendWhatsApp, whatsappConfigured } from "./notifications";
import { hasFeature } from "./plan";

// Two ways to strengthen sign-in:
// - Two-factor (TOTP) for staff, who see many students' data: after the
//   password or a sign-in code, they type the 6-digit code from an
//   authenticator app (or a one-time recovery code).
// - Passwordless sign-in codes for students who forget passwords: a 6-digit
//   code by email or WhatsApp, valid for 10 minutes and 5 tries.

const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;

type UserRow = typeof users.$inferSelect;

// ---------- Two-factor (TOTP) ----------

export async function startTotpSetup(db: Db, user: UserRow) {
  if (user.totpSecretEnc) throw badRequest("Two-factor sign-in is already on");
  const secret = newTotpSecret();
  await db.update(users).set({ totpPendingEnc: encrypt(secret) }).where(eq(users.id, user.id));
  return { secret, otpauthUrl: otpauthUrl(secret, user.email, "PlayCode") };
}

const newRecoveryCodes = () => Array.from({ length: 8 }, () => randomToken(6).replace(/[^a-zA-Z0-9]/g, "x").slice(0, 8).toUpperCase());

export async function confirmTotpSetup(db: Db, user: UserRow, code: string, now: Date) {
  if (!user.totpPendingEnc) throw badRequest("Start the setup first");
  const secret = decrypt(user.totpPendingEnc);
  const step = verifyTotp(secret, code, now, null);
  if (step === null) throw badRequest("That code didn't match. Check the time on your phone and try the newest code.");
  const recovery = newRecoveryCodes();
  await db
    .update(users)
    .set({ totpSecretEnc: user.totpPendingEnc, totpPendingEnc: null, totpLastStep: step, recoveryCodes: recovery.map((c) => sha256(c)) })
    .where(eq(users.id, user.id));
  await audit(db, { tenantId: user.tenantId, actorId: user.id, action: "auth.2fa_on" });
  return { recoveryCodes: recovery };
}

/** Check a second factor: an authenticator code (no reuse within its window) or an unused recovery code. */
export async function checkSecondFactor(db: Db, user: UserRow, code: string, now: Date): Promise<boolean> {
  if (!user.totpSecretEnc) return false;
  const clean = code.replace(/\s|-/g, "");
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decrypt(user.totpSecretEnc), clean, now, user.totpLastStep);
    if (step === null) return false;
    await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
    return true;
  }
  const hash = sha256(clean.toUpperCase());
  if (!user.recoveryCodes.includes(hash)) return false;
  await db.update(users).set({ recoveryCodes: user.recoveryCodes.filter((h) => h !== hash) }).where(eq(users.id, user.id));
  await audit(db, { tenantId: user.tenantId, actorId: user.id, action: "auth.recovery_code_used", data: { left: user.recoveryCodes.length - 1 } });
  return true;
}

export async function disableTotp(db: Db, user: UserRow, actorId: string) {
  await db.update(users).set({ totpSecretEnc: null, totpPendingEnc: null, totpLastStep: null, recoveryCodes: [] }).where(eq(users.id, user.id));
  await audit(db, { tenantId: user.tenantId, actorId, action: actorId === user.id ? "auth.2fa_off" : "auth.2fa_reset", target: user.id });
}

// ---------- Sign-in codes ----------

const hashCode = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");

/**
 * Send a sign-in code if the account exists and can receive one. Always
 * answers the same way, so it can't be used to find out who has an account.
 */
export async function requestLoginCode(db: Db, input: { email: string; channel: "email" | "whatsapp" }, now: Date) {
  const [user] = await db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase()));
  if (!user || user.status !== "active") return;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const viaWhatsApp =
    input.channel === "whatsapp" && user.phone && whatsappConfigured() && user.tenantId && (await hasFeature(db, user.tenantId, "whatsapp"));
  const m = mailer();
  if (!viaWhatsApp && !m) return;
  await db.insert(loginCodes).values({ userId: user.id, codeHash: hashCode(user.id, code), channel: viaWhatsApp ? "whatsapp" : "email", expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now });
  if (viaWhatsApp) {
    await sendWhatsApp(user.phone!, "login_code", [code]);
  } else {
    await m!.send({
      to: user.email,
      subject: `${code} is your PlayCode sign-in code`,
      text: `Your PlayCode sign-in code is ${code}.\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email; nobody can sign in without the code.`,
    });
  }
  await audit(db, { tenantId: user.tenantId, actorId: user.id, action: "auth.code_sent", data: { channel: viaWhatsApp ? "whatsapp" : "email" } });
}

/** Check a sign-in code; returns the user it signs in. */
export async function verifyLoginCode(db: Db, input: { email: string; code: string }, now: Date): Promise<UserRow> {
  const fail = () => unauthorized("That code is wrong or has expired. Ask for a new one.");
  const [user] = await db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase()));
  if (!user || user.status !== "active") throw fail();
  const [latest] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.userId, user.id), isNull(loginCodes.usedAt), gt(loginCodes.expiresAt, now)))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!latest || latest.attempts >= MAX_CODE_ATTEMPTS) throw fail();
  if (!safeEqual(latest.codeHash, hashCode(user.id, input.code.replace(/\s/g, "")))) {
    await db.update(loginCodes).set({ attempts: latest.attempts + 1 }).where(eq(loginCodes.id, latest.id));
    throw fail();
  }
  // Single use: claim it, so two simultaneous tries can't both succeed.
  const claimed = await db.update(loginCodes).set({ usedAt: now }).where(and(eq(loginCodes.id, latest.id), isNull(loginCodes.usedAt))).returning();
  if (claimed.length === 0) throw fail();
  return user;
}

export const otpChannelsAvailable = () => ({ email: Boolean(mailer()), whatsapp: whatsappConfigured() && Boolean(env.WHATSAPP_PHONE_ID) });
