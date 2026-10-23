import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, type TestApp } from "./helpers";

let t: TestApp;

beforeAll(async () => {
  t = await setup();
});

afterAll(async () => {
  delete process.env.METRICS_TOKEN;
  await t.app.close();
  await pool.end();
});

describe("monitoring", () => {
  it("tags every response with a request id, keeping one from the load balancer", async () => {
    const own = await t.app.inject({ method: "GET", url: "/health" });
    expect(own.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const given = await t.app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "lb-trace-12345678" } });
    expect(given.headers["x-request-id"]).toBe("lb-trace-12345678");
    const junk = await t.app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "<script>" } });
    expect(junk.headers["x-request-id"]).not.toBe("<script>");
  });

  it("sends security headers, and never lets signed-in responses be cached", async () => {
    const pub = await t.app.inject({ method: "GET", url: "/health" });
    expect(pub.headers).toMatchObject({ "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" });
    expect(pub.headers["cache-control"]).toBeUndefined();
    const token = await t.login("student@demo.edu");
    const me = await t.app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.headers["cache-control"]).toBe("no-store");
  });

  it("is ready once the database is reachable and fully migrated", async () => {
    const res = await t.app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ready: true, database: true });
    expect(body.migrations.applied).toBe(body.migrations.expected);
  });

  it("serves Prometheus metrics only with the metrics token", async () => {
    expect((await t.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(404);
    process.env.METRICS_TOKEN = "scrape-secret";
    expect((await t.app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    await t.login("student@demo.edu");
    const res = await t.app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer scrape-secret" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toMatch(/playcode_http_requests_total\{method="POST",route="\/auth\/login",status="200"\} \d+/);
    expect(res.body).toContain('playcode_http_request_duration_seconds_bucket{method="POST",route="/auth/login",le="+Inf"}');
    expect(res.body).toContain('playcode_job_healthy{job="nudges"} 0');
    expect(res.body).toContain('playcode_outbox_pending{outbox="notifications"}');
  });

  it("shows PlayCode staff the system status", async () => {
    const sa = await t.login("superadmin@playcode.dev");
    const res = await t.get(sa, "/admin/system");
    expect(res.body.ready.ready).toBe(true);
    expect(res.body.jobs.map((j: { job: string }) => j.job)).toEqual(["nudges", "webhooks", "league", "retention"]);
    expect(res.body.backlog).toHaveProperty("notificationsPending");
    expect(res.body.databaseBytes).toBeGreaterThan(0);
    expect((await t.get(await t.login("admin@demo.edu"), "/admin/system")).status).toBe(403);
  });
});
