import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { tenants, type TenantBranding } from "../db/schema";
import { badRequest } from "../lib/errors";
import { putObject } from "../lib/storage";

type TenantRow = typeof tenants.$inferSelect;

export const DEFAULT_APP_NAME = "PlayCode";
const MAX_LOGO_BYTES = 200_000;

/** Branding as shown to users: the tenant's own settings, falling back to its partner's. */
export async function effectiveBranding(db: DbOrTx, tenant: TenantRow) {
  let parent: TenantRow | undefined;
  if (tenant.parentId) [parent] = await db.select().from(tenants).where(eq(tenants.id, tenant.parentId));
  const own = tenant.branding;
  const inherited = parent?.branding ?? {};
  const logoOwner = own.logoKey ? tenant.id : inherited.logoKey ? parent!.id : null;
  return {
    tenantName: tenant.name,
    slug: tenant.slug,
    appName: own.appName ?? inherited.appName ?? DEFAULT_APP_NAME,
    primaryColor: own.primaryColor ?? inherited.primaryColor ?? null,
    logoUrl: logoOwner ? `/public/logo/${logoOwner}` : null,
    certificateSignatory: own.certificateSignatory ?? inherited.certificateSignatory ?? null,
  };
}

export async function updateBranding(
  db: DbOrTx,
  tenant: TenantRow,
  input: { appName?: string | null; primaryColor?: string | null; certificateSignatory?: string | null; logo?: string | null },
) {
  const next: TenantBranding = { ...tenant.branding };
  const set = <K extends keyof TenantBranding>(key: K, value: TenantBranding[K] | null | undefined) => {
    if (value === undefined) return;
    if (value === null || value === "") delete next[key];
    else next[key] = value;
  };
  set("appName", input.appName?.trim());
  set("primaryColor", input.primaryColor);
  set("certificateSignatory", input.certificateSignatory?.trim());
  if (input.logo === null) {
    delete next.logoKey;
    delete next.logoType;
  } else if (input.logo) {
    // Raster images only: an uploaded SVG could carry script.
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.logo);
    if (!m) throw badRequest("The logo must be a PNG, JPEG or WebP image");
    const data = Buffer.from(m[2]!, "base64");
    if (data.length > MAX_LOGO_BYTES) throw badRequest("The logo must be under 200 KB");
    const key = `logos/${tenant.id}/${Date.now()}`;
    await putObject(key, data);
    next.logoKey = key;
    next.logoType = m[1]!;
  }
  const [updated] = await db.update(tenants).set({ branding: next }).where(eq(tenants.id, tenant.id)).returning();
  return updated!;
}
