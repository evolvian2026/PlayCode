import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { db, pool } from "../src/db/client";
import { deployDatabase } from "../src/db/deploy";
import { resetDatabase } from "../src/db/reset";
import { questions, tenants, users } from "../src/db/schema";
import { resetRateLimits } from "../src/lib/rate-limit";
import { ensureSupabaseBucket, localStore, supabaseStore } from "../src/lib/storage";
import { createSuperAdmin } from "../src/scripts/create-admin";

afterAll(async () => {
  await pool.end();
});

/** A stand-in for Supabase Storage's REST API, keeping objects in memory. */
function fakeSupabase() {
  const objects = new Map<string, Buffer>();
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ method, url, headers: init.headers as Record<string, string> });
    const key = decodeURIComponent(url.replace(/^.*\/object\/(authenticated\/)?/, ""));
    if (method === "POST") {
      objects.set(key, Buffer.from(init.body as Uint8Array));
      return new Response("{}", { status: 200 });
    }
    if (!objects.has(key)) return new Response('{"statusCode":"404","error":"not_found","message":"Object not found"}', { status: 400 });
    if (method === "DELETE") {
      objects.delete(key);
      return new Response("[]", { status: 200 });
    }
    return new Response(new Uint8Array(objects.get(key)!), { status: 200 });
  }) as typeof fetch;
  return { impl, objects, calls };
}

describe("object storage", () => {
  it("keeps files in a private Supabase bucket with the service key", async () => {
    const fake = fakeSupabase();
    const store = supabaseStore("https://abc.supabase.co/", "service-key", "playcode-files", fake.impl);
    await store.put("snapshots/a b/1.jpg", Buffer.from("jpeg"));
    expect(fake.calls[0]).toMatchObject({ method: "POST", url: "https://abc.supabase.co/storage/v1/object/playcode-files/snapshots/a%20b/1.jpg" });
    expect(fake.calls[0]!.headers).toMatchObject({ authorization: "Bearer service-key", apikey: "service-key", "x-upsert": "true" });
    expect((await store.get("snapshots/a b/1.jpg"))?.toString()).toBe("jpeg");
    expect(fake.calls[1]!.url).toContain("/object/authenticated/playcode-files/");
    await store.delete("snapshots/a b/1.jpg");
    // Missing files read as nothing, and deleting one twice is fine.
    expect(await store.get("snapshots/a b/1.jpg")).toBeNull();
    await expect(store.delete("snapshots/a b/1.jpg")).resolves.toBeUndefined();
  });

  it("refuses keys that climb out of the store, and surfaces real errors", async () => {
    const fake = fakeSupabase();
    const store = supabaseStore("https://abc.supabase.co", "k", "b", fake.impl);
    await expect(store.put("../etc/passwd", Buffer.from("x"))).rejects.toThrow("bad storage key");
    const down = supabaseStore("https://abc.supabase.co", "k", "b", (async () => new Response("boom", { status: 503 })) as typeof fetch);
    await expect(down.get("a")).rejects.toThrow("Storage download failed (503)");
    const local = localStore(await mkdtemp(join(tmpdir(), "pc-")));
    await expect(local.get("/etc/passwd")).rejects.toThrow("bad storage key");
  });

  it("creates the bucket once, private", async () => {
    const bodies: string[] = [];
    let exists = false;
    const impl = (async (_u: string | URL | Request, init: RequestInit = {}) => {
      bodies.push(String(init.body));
      if (exists) return new Response('{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}', { status: 400 });
      exists = true;
      return new Response('{"name":"playcode-files"}', { status: 200 });
    }) as typeof fetch;
    expect(await ensureSupabaseBucket("https://abc.supabase.co", "k", "playcode-files", impl)).toBe("created");
    expect(await ensureSupabaseBucket("https://abc.supabase.co", "k", "playcode-files", impl)).toBe("exists");
    expect(JSON.parse(bodies[0]!)).toEqual({ id: "playcode-files", name: "playcode-files", public: false });
  });
});

describe("a fresh production database", () => {
  it("gets content but no demo college or demo accounts", async () => {
    await resetDatabase();
    await deployDatabase();
    // Running it again on the next deploy changes nothing.
    await deployDatabase();
    expect((await db.select({ n: count() }).from(questions))[0]!.n).toBeGreaterThan(100);
    expect((await db.select({ n: count() }).from(tenants))[0]!.n).toBe(0);
    expect((await db.select({ n: count() }).from(users))[0]!.n).toBe(0);
  });

  it("gets its first super admin with a one-time random password", async () => {
    await expect(createSuperAdmin(db, { email: "not an email", name: "x" })).rejects.toThrow("valid email");
    const first = await createSuperAdmin(db, { email: " Ops@Example.com ", name: "Ops" });
    expect(first.created).toBe(true);
    const password = (first as { password: string }).password;
    expect(password.length).toBeGreaterThanOrEqual(24);
    // Running it again can't reset the password of an existing account.
    expect(await createSuperAdmin(db, { email: "ops@example.com", name: "Ops" })).toEqual({ created: false });
    await resetRateLimits();
    const app = await buildApp({ now: () => new Date() });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "ops@example.com", password } });
    expect(login.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/auth/login", payload: { email: "superadmin@playcode.dev", password: "playcode123" } })).statusCode).toBe(401);
    await app.close();
  });
});
