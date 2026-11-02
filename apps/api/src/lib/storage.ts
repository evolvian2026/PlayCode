import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { env } from "../env";

// File storage for proctoring snapshots, logos and students' uploaded
// documents. Two drivers: this server's disk (one server, or development), or
// a private Supabase Storage bucket, which every service (the API, the hourly
// job that reviews missed snapshots, the nightly clean-up) can reach. Files are
// encrypted at rest by the store; snapshots are deleted by the retention job.

export interface ObjectStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

/** A key with no way out of the store: no leading slash and no "..". */
function safeKey(key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => part === ".." || part === ".")) throw new Error("bad storage key");
  return normalize(key);
}

export function localStore(dir: string): ObjectStore {
  const pathFor = (key: string) => join(dir, safeKey(key));
  return {
    async put(key, data) {
      const p = pathFor(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    async get(key) {
      const p = pathFor(key);
      try {
        return await readFile(p);
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

/** A private Supabase Storage bucket, through its REST API with the service role key (server-side only). */
export function supabaseStore(url: string, serviceKey: string, bucket: string, fetchImpl: typeof fetch = fetch): ObjectStore {
  const base = `${url.replace(/\/$/, "")}/storage/v1`;
  const path = (key: string) => safeKey(key).split("/").map(encodeURIComponent).join("/");
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  // Supabase answers a missing object with 404, or 400 carrying statusCode "404".
  const missing = async (res: Response) => res.status === 404 || (res.status === 400 && /"statusCode":\s*"404"|not.?found/i.test(await res.text()));
  return {
    async put(key, data) {
      const res = await fetchImpl(`${base}/object/${bucket}/${path(key)}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/octet-stream", "x-upsert": "true" },
        body: new Uint8Array(data),
      });
      if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
    },
    async get(key) {
      const res = await fetchImpl(`${base}/object/authenticated/${bucket}/${path(key)}`, { headers });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (await missing(res)) return null;
      throw new Error(`Storage download failed (${res.status})`);
    },
    async delete(key) {
      const res = await fetchImpl(`${base}/object/${bucket}/${path(key)}`, { method: "DELETE", headers });
      if (!res.ok && !(await missing(res))) throw new Error(`Storage delete failed (${res.status})`);
    },
  };
}

/** Create the private bucket if it isn't there; run at deploy time. */
export async function ensureSupabaseBucket(url: string, serviceKey: string, bucket: string, fetchImpl: typeof fetch = fetch): Promise<"created" | "exists"> {
  const res = await fetchImpl(`${url.replace(/\/$/, "")}/storage/v1/bucket`, {
    method: "POST",
    headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "content-type": "application/json" },
    body: JSON.stringify({ id: bucket, name: bucket, public: false }),
  });
  if (res.ok) return "created";
  const body = await res.text();
  if (res.status === 409 || /already exists|Duplicate/i.test(body)) return "exists";
  throw new Error(`Could not create storage bucket (${res.status}): ${body.slice(0, 200)}`);
}

const store: ObjectStore =
  env.STORAGE_DRIVER === "supabase" ? supabaseStore(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, env.STORAGE_BUCKET) : localStore(env.STORAGE_DIR);

export const putObject = (key: string, data: Buffer) => store.put(key, data);
export const getObject = (key: string) => store.get(key);
export const deleteObject = (key: string) => store.delete(key);
