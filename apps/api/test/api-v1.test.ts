import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { hmacSha256 } from "../src/lib/crypto";
import { deliverDue, isPrivateAddress } from "../src/services/webhooks";
import { rightAnswer, setup, START, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
let receiver: Server;
let port: number;
let failNext = 0;
const received: { headers: IncomingMessage["headers"]; body: string }[] = [];

async function token(clientId: string, secret: string) {
  const res = await t.post("", "/v1/oauth/token", { grant_type: "client_credentials", client_id: clientId, client_secret: secret });
  return res.body.access_token as string;
}

beforeAll(async () => {
  t = await setup();
  admin = await t.login("admin@demo.edu");
  receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      if (failNext > 0) {
        failNext--;
        res.writeHead(500).end();
      } else res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  port = (receiver.address() as { port: number }).port;
});

afterAll(async () => {
  receiver.close();
  await t.app.close();
  await pool.end();
});

describe("public API", () => {
  let clientId: string;
  let secret: string;

  it("issues client-credential tokens", async () => {
    const created = await t.post(admin, "/console/api-clients", { name: "College ERP", scopes: ["users:read", "users:write", "assignments:read", "assignments:write", "results:read"] });
    expect(created.status).toBe(200);
    clientId = created.body.client.clientId;
    secret = created.body.clientSecret;
    expect((await t.get(admin, "/console/api-clients")).body.clients[0]).not.toHaveProperty("secretHash");

    expect(await token(clientId, secret)).toBeTruthy();
    const form = await t.app.inject({ method: "POST", url: "/v1/oauth/token", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: `grant_type=client_credentials&client_id=${clientId}&client_secret=${secret}` });
    expect(form.json().token_type).toBe("Bearer");
    const basic = await t.app.inject({ method: "POST", url: "/v1/oauth/token", headers: { authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}` }, payload: { grant_type: "client_credentials" } });
    expect(basic.statusCode).toBe(200);
    expect((await t.post("", "/v1/oauth/token", { grant_type: "client_credentials", client_id: clientId, client_secret: "wrong" })).status).toBe(401);
  });

  it("keeps API and user tokens apart", async () => {
    const api = await token(clientId, secret);
    expect((await t.get(admin, "/v1/users")).status).toBe(401);
    expect((await t.get(api, "/me")).status).toBe(401);
    expect((await t.get(api, "/console/students")).status).toBe(401);
  });

  it("pages through students with cursors", async () => {
    const api = await token(clientId, secret);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await t.get(api, `/v1/users?limit=10${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((u: { id: string }) => u.id));
      cursor = res.body.next_cursor;
    } while (cursor);
    expect(seen.length).toBe(31);
    expect(new Set(seen).size).toBe(31);
    const units = (await t.get(api, "/v1/org-units")).body.data;
    expect(units.length).toBe(7);
  });

  it("enforces scopes and revocation", async () => {
    const narrow = await t.post(admin, "/console/api-clients", { name: "Read only", scopes: ["users:read"] });
    const api = await token(narrow.body.client.clientId, narrow.body.clientSecret);
    expect((await t.get(api, "/v1/users")).status).toBe(200);
    expect((await t.get(api, "/v1/results")).status).toBe(403);
    await t.post(admin, `/console/api-clients/${narrow.body.client.id}/revoke`, {});
    expect((await t.get(api, "/v1/users")).status).toBe(401);
    expect((await t.post("", "/v1/oauth/token", { grant_type: "client_credentials", client_id: narrow.body.client.clientId, client_secret: narrow.body.clientSecret })).status).toBe(401);
    const tpo = await t.login("tpo@demo.edu");
    expect((await t.get(tpo, "/console/api-clients")).status).toBe(403);
  });

  it("delivers signed webhooks and retries failures", async () => {
    t.clock.now = new Date(START);
    const hook = await t.post(admin, "/console/webhooks", { url: `http://127.0.0.1:${port}/hooks`, events: ["user.created", "assignment.completed"] });
    expect(hook.status).toBe(200);
    const signingSecret = hook.body.signingSecret as string;

    // Creating students through the API fires user.created.
    const api = await token(clientId, secret);
    const units = (await t.get(api, "/v1/org-units")).body.data as { id: string; name: string }[];
    const unitA = units.find((u) => u.name === "CSE 2027 - A")!.id;
    const created = await t.post(api, "/v1/users", { unit_id: unitA, students: [{ name: "Api Student", email: "api.student@demo.edu", roll_no: "API1" }], default_password: "student-pass-1" });
    expect(created.body.created).toHaveLength(1);
    await deliverDue(db, t.clock.now);
    // A background run may have claimed it first; wait for it to arrive.
    for (let i = 0; i < 40 && !received.some((r) => r.headers["x-playcode-event"] === "user.created"); i++) await new Promise((r) => setTimeout(r, 50));
    const evt = received.find((r) => r.headers["x-playcode-event"] === "user.created");
    expect(evt).toBeTruthy();
    const [tPart, vPart] = String(evt!.headers["x-playcode-signature"]).split(",");
    const ts = tPart!.slice(2);
    expect(vPart!.slice(3)).toBe(hmacSha256(signingSecret, `${ts}.${evt!.body}`));
    expect(JSON.parse(evt!.body).data.email).toBe("api.student@demo.edu");

    // An assignment created through the API and completed by the student fires assignment.completed.
    const asg = await t.post(api, "/v1/assignments", { title: "API quiz", skill_ids: ["loops.for"], count: 2, unit_ids: [unitA], open_at: new Date(START.getTime() - 60_000).toISOString(), close_at: new Date(START.getTime() + 86_400_000).toISOString() });
    expect(asg.status).toBe(200);
    const student = await t.login("api.student@demo.edu", "student-pass-1");
    failNext = 1; // the first attempt fails, the retry succeeds
    let s = (await t.post(student, "/student/sessions", { kind: "assignment", assignmentId: asg.body.data.id })).body;
    while (!s.finished) {
      const qid = s.question.id;
      s = (await t.post(student, `/student/sessions/${s.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 5000 })).body.session;
    }
    await deliverDue(db, t.clock.now);
    // The answer also triggers a background delivery run; wait for the first attempt to land.
    let completed: { event: string; status: string; attempts: number } | undefined;
    for (let i = 0; i < 40 && !completed?.attempts; i++) {
      const deliveries = (await t.get(admin, `/console/webhooks/${hook.body.webhook.id}/deliveries`)).body.deliveries as { event: string; status: string; attempts: number }[];
      completed = deliveries.find((d) => d.event === "assignment.completed");
      if (!completed?.attempts) await new Promise((r) => setTimeout(r, 50));
    }
    if (!completed) throw new Error("no assignment.completed delivery");
    expect(completed.status).toBe("pending");
    expect(completed.attempts).toBe(1);
    // The retry is due one minute later; the claim lease (5 min) must not block it.
    await deliverDue(db, new Date(t.clock.now.getTime() + 61_000));
    const after = (await t.get(admin, `/console/webhooks/${hook.body.webhook.id}/deliveries`)).body.deliveries.find((d: { event: string }) => d.event === "assignment.completed");
    expect(after.status).toBe("delivered");
    expect(JSON.parse(received.at(-1)!.body).data.scorePct).toBe(100);

    // The results feed shows the completion.
    const results = (await t.get(api, "/v1/results")).body.data;
    expect(results.some((r: { assignment_id: string }) => r.assignment_id === asg.body.data.id)).toBe(true);
    const test = await t.post(admin, `/console/webhooks/${hook.body.webhook.id}/test`, {});
    expect(test.body.result.delivered).toBe(1);
  });

  it("refuses webhook targets on private networks", () => {
    expect(["10.0.0.1", "127.0.0.1", "192.168.1.5", "172.20.0.1", "169.254.169.254", "::1", "100.64.0.1"].every(isPrivateAddress)).toBe(true);
    expect(["8.8.8.8", "142.250.1.1", "172.32.0.1"].some(isPrivateAddress)).toBe(false);
  });
});
