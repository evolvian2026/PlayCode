// Each vitest worker gets its own database, so test files can run in
// parallel: worker n of run r uses <TEST_DATABASE_URL's database>_r<r>_<n>.
// The run id keeps two test runs at once (a watcher and a full run) apart.
// Every file resets and reseeds its worker's database in setup(), as before.

export const BASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://playcode:playcode@localhost:5432/playcode_test";
export const WORKERS = Math.max(1, Number(process.env.TEST_WORKERS ?? 4));
/** Set once in the main process (vitest.config.ts); workers inherit it. */
export const RUN = process.env.TEST_RUN ?? "0";

export const baseName = () => new URL(BASE_URL).pathname.slice(1);

export function workerUrl(worker: number | string, run = RUN): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${baseName()}_r${run}_${worker}`;
  return url.toString();
}
