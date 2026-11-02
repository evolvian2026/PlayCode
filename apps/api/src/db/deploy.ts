import { env } from "../env";
import { ensureSupabaseBucket } from "../lib/storage";
import { pool } from "./client";
import { runMigrations } from "./migrate";
import { seedContent } from "./seed";

// Run on every production deploy, before the new version starts: apply
// migrations, load the question bank, skills and mission packs (upserts that
// keep calibration data), and make sure the storage bucket exists. It never
// creates the demo college or demo accounts; `db:seed` does that and is for
// development only.

export async function deployDatabase(): Promise<void> {
  await runMigrations();
  await seedContent();
  if (env.STORAGE_DRIVER === "supabase") {
    const bucket = await ensureSupabaseBucket(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, env.STORAGE_BUCKET);
    console.log(`Storage bucket ${env.STORAGE_BUCKET}: ${bucket}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await deployDatabase();
  console.log("Migrations applied and content loaded");
  await pool.end();
}
