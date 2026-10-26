import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";
// One id per test run, for its databases (test/databases.ts); set before that module loads.
process.env.TEST_RUN ??= String(process.pid);
const { WORKERS } = await import("./test/databases");

export default defineConfig({
  test: {
    // Files run in parallel, each worker on its own database (test/databases.ts).
    maxWorkers: WORKERS,
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/worker-db.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      JWT_SECRET: "test-secret-test-secret-test-secret",
      STORAGE_DIR: join(tmpdir(), "playcode-test-storage"),
      // Webhook tests deliver to a local receiver.
      ALLOW_PRIVATE_URLS: "true",
    },
  },
});
