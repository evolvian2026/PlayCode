import { auditLogs } from "../db/schema";
import type { DbOrTx } from "../db/client";

export async function audit(
  db: DbOrTx,
  entry: { tenantId: string | null; actorId: string | null; action: string; target?: string; data?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLogs).values({ ...entry, data: entry.data ?? {} });
}
