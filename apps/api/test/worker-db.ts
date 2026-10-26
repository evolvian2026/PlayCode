import { workerUrl } from "./databases";

// Runs before each test file's imports, so the app's env module sees this worker's database.
process.env.DATABASE_URL = workerUrl(process.env.VITEST_POOL_ID ?? "1");
