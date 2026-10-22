import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://playcode:playcode@localhost:5432/playcode_test",
      JWT_SECRET: "test-secret-test-secret-test-secret",
      STORAGE_DIR: join(tmpdir(), "playcode-test-storage"),
    },
  },
});
