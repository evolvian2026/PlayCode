import { eq } from "drizzle-orm";
import { effectiveEnd, licenceStatus, localDate, type LicenceStatus } from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { tenants } from "../db/schema";
import { HttpError } from "../lib/errors";

// Licence enforcement: full access until the end date and through the grace
// period, then read-only. A college under a partner also stops when the
// partner's own licence does.

export async function tenantLicence(db: DbOrTx, tenantId: string, now: Date): Promise<LicenceStatus & { tenantName: string }> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return { ...licenceStatus(null, localDate(now)), tenantName: "" };
  const [parent] = t.parentId ? await db.select({ validUntil: tenants.validUntil }).from(tenants).where(eq(tenants.id, t.parentId)) : [];
  return { ...licenceStatus(effectiveEnd(t.validUntil, parent?.validUntil), localDate(now, t.timeZone)), tenantName: t.name };
}

/** What still works for a read-only account: signing in and out, privacy rights, billing (so it can be paid), and account settings. */
const READ_ONLY_ALLOWED = ["/auth/", "/privacy", "/console/privacy", "/console/billing", "/console/security", "/push/", "/student/notifications/read", "/student/settings", "/student/talent", "/admin/", "/me"];

export class LicenceExpiredError extends HttpError {
  constructor(name: string, validUntil: string) {
    const ended = new Date(`${validUntil}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    super(403, "licence_expired", `The PlayCode licence for ${name} ended on ${ended}. You can still sign in and view your data; ask your institution to renew to continue practising.`);
  }
}

/** Refuse a change (non-GET request) for a tenant whose licence is past its grace period. */
export async function assertWritable(db: DbOrTx, args: { tenantId: string | null; method: string; url: string; superAdmin: boolean; now: Date }) {
  if (!args.tenantId || args.superAdmin || args.method === "GET" || args.method === "HEAD" || args.method === "OPTIONS") return;
  if (READ_ONLY_ALLOWED.some((p) => args.url.startsWith(p))) return;
  const lic = await tenantLicence(db, args.tenantId, args.now);
  if (lic.state === "expired") throw new LicenceExpiredError(lic.tenantName, lic.validUntil!);
}
