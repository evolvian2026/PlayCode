import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  console.log("Migrations applied");
  await pool.end();
}
