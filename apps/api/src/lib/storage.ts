import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { env } from "../env";

// File storage for proctoring snapshots. This local-disk driver suits one
// server; production should implement the same two functions over S3 or
// another object store (with server-side encryption and a lifecycle rule
// that deletes snapshots after the review window).

function pathFor(key: string): string {
  const safe = normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  if (safe.startsWith("/") || safe.includes("..")) throw new Error("bad storage key");
  return join(env.STORAGE_DIR, safe);
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  const p = pathFor(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data);
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    return await readFile(pathFor(key));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await rm(pathFor(key), { force: true });
}
