import { sql } from "drizzle-orm";
import { env } from "../env";
import { db, pool } from "./client";
import { runMigrations } from "./migrate";
import { seedDemo } from "./seed";

// Drops everything and rebuilds the demo database. Development only.
if (env.NODE_ENV === "production") throw new Error("db:reset is disabled in production");

export async function resetDatabase(): Promise<void> {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await resetDatabase();
  await seedDemo();
  await pool.end();
}
