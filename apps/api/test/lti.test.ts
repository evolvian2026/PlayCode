import { createServer, type Server } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type CryptoKey, type JSONWebKeySet } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { deliverLtiScores } from "../src/services/lti";
import { rightAnswer, setup, START, type TestApp } from "./helpers";

// A mock LMS: OIDC auth endpoint (not called, we follow the redirect by hand),
// its JWKS, an OAuth2 token endpoint that checks PlayCode's client assertion,
// and a gradebook line item that records scores.
let t: TestApp;
let admin: string;
let faculty: string;
let lms: Server;
let issuer: string;
let lmsKey: CryptoKey;
const scores: { url: string; auth: string; contentType: string; body: Record<string, unknown> }[] = [];
const tokenRequests: URLSearchParams[] = [];

const LTI = "https://purl.imsglobal.org/spec/lti/claim/";

beforeAll(async () => {
  t = await setup();
  admin = await t.login("admin@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  const keys = await generateKeyPair("RS256");
  lmsKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "lms-1", alg: "RS256", use: "sig" };
  lms = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const url = new URL(req.url!, issuer);
      if (url.pathname === "/jwks") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [jwk] }));
      if (url.pathname === "/token") {
        const form = new URLSearchParams(body);
        tokenRequests.push(form);
        // Verify PlayCode's signed client assertion against its published JWKS.
        const jwks = (await t.app.inject({ method: "GET", url: "/lti/jwks" })).json() as JSONWebKeySet;
        try {
          await jwtVerify(form.get("client_assertion")!, createLocalJWKSet(jwks), { issuer: "moodle-client", subject: "moodle-client", audience: `${issuer}/token`, currentDate: t.clock.now });
        } catch {
          return res.writeHead(401).end();
        }
        return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "lms-access", token_type: "Bearer", expires_in: 3600 }));
      }
      if (url.pathname === "/lineitems/9/scores" && req.method === "POST") {
        scores.push({ url: url.toString(), auth: String(req.headers.authorization), contentType: String(req.headers["content-type"]), body: JSON.parse(body) });
        return res.writeHead(200).end();
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => lms.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(lms.address() as { port: number }).port}`;
});

afterAll(async () => {
  lms.close();
  await t.app.close();
  await pool.end();
});

/** Login initiation, then a launch carrying an id_token the mock LMS signs. Returns where PlayCode sends the browser. */
async function launch(claims: Record<string, unknown>, opts: { replay?: boolean; badKey?: boolean } = {}) {
  const login = await t.app.inject({ method: "GET", url: `/lti/login?iss=${encodeURIComponent(issuer)}&login_hint=hint-1&lti_message_hint=m-1&target_link_uri=x` });
  expect(login.statusCode).toBe(302);
  const auth = new URL(login.headers.location as string);
  expect(auth.pathname).toBe("/auth");
  expect(auth.searchParams.get("response_mode")).toBe("form_post");
  expect(auth.searchParams.get("redirect_uri")).toMatch(/\/lti\/launch$/);
  const key = opts.badKey ? (await generateKeyPair("RS256")).privateKey : lmsKey;
  const iat = Math.floor(t.clock.now.getTime() / 1000);
  const idToken = await new SignJWT({
    nonce: auth.searchParams.get("nonce"),
    [`${LTI}version`]: "1.3.0",
    [`${LTI}message_type`]: "LtiResourceLinkRequest",
    [`${LTI}deployment_id`]: "dep-1",
    [`${LTI}resource_link`]: { id: "rl-1", title: "PlayCode: loops practice" },
    [`${LTI}context`]: { id: "c-1", title: "CS101 Programming" },
    "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": { scope: ["https://purl.imsglobal.org/spec/lti-ags/scope/score"], lineitem: `${issuer}/lineitems/9?type_id=1` },
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "lms-1" })
    .setIssuer(issuer)
    .setAudience("moodle-client")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(key);
  const post = () =>
    t.app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ id_token: idToken, state: auth.searchParams.get("state")! }).toString(),
    });
  let res = await post();
  if (opts.replay) res = await post();
  expect(res.statusCode).toBe(302);
  const location = res.headers.location as string;
  const fragment = new URLSearchParams(location.split("#")[1] ?? "");
  return { location, token: fragment.get("token"), next: fragment.get("next"), error: new URL(location).searchParams.get("sso_error") };
}

const learner = (sub: string, email?: string) => ({ sub, ...(email ? { email } : {}), name: "Lms Learner", [`${LTI}roles`]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"] });
const teacher = { sub: "moodle-teacher-1", email: "faculty@demo.edu", name: "Prof", [`${LTI}roles`]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"] };

describe("LTI 1.3", () => {
  let assignmentId: string;
  let linkId: string;

  it("registers an LMS and publishes the tool's keys", async () => {
    const units = (await t.get(admin, "/console/org-units")).body.units as { id: string; name: string }[];
    const unit = units.find((u) => u.name === "CSE 2027 - A")!.id;
    const res = await t.post(admin, "/console/lti/platforms", {
      name: "College Moodle",
      issuer,
      clientId: "moodle-client",
      deploymentIds: ["dep-1"],
      authLoginUrl: `${issuer}/auth`,
      authTokenUrl: `${issuer}/token`,
      jwksUrl: `${issuer}/jwks`,
      autoProvisionUnitId: unit,
    });
    expect(res.status).toBe(200);
    const cfg = (await t.get(admin, "/console/lti")).body;
    expect(cfg.tool.launchUrl).toMatch(/\/lti\/launch$/);
    expect(cfg.platforms).toHaveLength(1);
    expect((await t.get(faculty, "/console/lti")).status).toBe(403);
    const jwks = (await t.app.inject({ method: "GET", url: "/lti/jwks" })).json();
    expect(jwks.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
    expect(jwks.keys[0]).not.toHaveProperty("d");

    const asg = await t.post(faculty, "/console/assignments", {
      title: "LMS loops",
      skillIds: ["loops.for"],
      count: 3,
      unitIds: [unit],
      openAt: new Date(START.getTime() - 60_000).toISOString(),
      closeAt: new Date(START.getTime() + 86_400_000).toISOString(),
    });
    expect(asg.status, JSON.stringify(asg.body)).toBe(200);
    assignmentId = asg.body.assignment?.id ?? asg.body.id;
    expect(assignmentId).toBeTruthy();
  });

  it("lets a teacher launch and connect the activity to an assignment", async () => {
    const r = await launch(teacher);
    expect(r.error).toBeNull();
    expect(r.next).toMatch(/^\/console\/lti\/link\?id=/);
    linkId = r.next!.split("id=")[1]!;
    const link = (await t.get(r.token!, `/console/lti/links/${linkId}`)).body.link;
    expect(link).toMatchObject({ title: "PlayCode: loops practice", course: "CS101 Programming", platform: "College Moodle", gradebook: true, assignmentId: null });
    expect((await t.post(r.token!, `/console/lti/links/${linkId}`, { assignmentId })).body.link.assignmentId).toBe(assignmentId);
    // Bound now, so the next teacher launch goes to the console.
    expect((await launch(teacher)).next).toBe("/console/assignments");
  });

  it("signs learners in, creating their account on first launch", async () => {
    const r = await launch(learner("moodle-user-7", "lti.learner@demo.edu"));
    expect(r.error).toBeNull();
    expect(r.next).toBe(`/play/start?assignment=${assignmentId}`);
    const me = (await t.get(r.token!, "/me")).body;
    expect(me.user).toMatchObject({ email: "lti.learner@demo.edu", roles: ["student"] });

    // A learner whose LMS hides their email still gets an account.
    const anon = await launch(learner("moodle-user-8"));
    expect((await t.get(anon.token!, "/me")).body.user.email).toMatch(/^lti-[0-9a-f]{16}@lti\.invalid$/);
  });

  it("rejects replays, forged tokens and unknown deployments", async () => {
    expect((await launch(learner("moodle-user-7"), { replay: true })).error).toContain("already used");
    expect((await launch(learner("moodle-user-7"), { badKey: true })).error).toContain("Could not verify");
    expect((await launch({ ...learner("moodle-user-7"), [`${LTI}deployment_id`]: "dep-x" })).error).toContain("deployment is not allowed");
    expect((await launch({ ...learner("moodle-user-7"), [`${LTI}message_type`]: "LtiDeepLinkingRequest" })).error).toContain("activity launches only");
    const student = { ...teacher, sub: "moodle-teacher-2", email: "student@demo.edu" };
    expect((await launch(student)).error).toContain("student account");
    const login = await t.app.inject({ method: "GET", url: `/lti/login?iss=${encodeURIComponent("https://unknown.example")}&login_hint=x` });
    expect(login.statusCode).toBe(400);
  });

  it("sends the score to the LMS gradebook when the learner finishes", async () => {
    const r = await launch(learner("moodle-user-7"));
    let s = (await t.post(r.token!, "/student/sessions", { kind: "assignment", assignmentId })).body;
    expect(s.total).toBe(3);
    while (!s.finished) {
      const qid = s.question.id;
      s = (await t.post(r.token!, `/student/sessions/${s.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 10_000 })).body.session;
    }
    await deliverLtiScores(db, t.clock.now);
    for (let i = 0; i < 40 && scores.length === 0; i++) await new Promise((res) => setTimeout(res, 50));
    expect(scores).toHaveLength(1);
    expect(scores[0]!.url).toBe(`${issuer}/lineitems/9/scores?type_id=1`);
    expect(scores[0]!.auth).toBe("Bearer lms-access");
    expect(scores[0]!.contentType).toBe("application/vnd.ims.lis.v1.score+json");
    expect(scores[0]!.body).toMatchObject({ userId: "moodle-user-7", scoreGiven: 3, scoreMaximum: 3, activityProgress: "Completed", gradingProgress: "FullyGraded" });
    expect(tokenRequests[0]!.get("scope")).toBe("https://purl.imsglobal.org/spec/lti-ags/scope/score");

    const links = (await t.get(faculty, "/console/lti/links")).body.links;
    expect(links[0]).toMatchObject({ assignment: "LMS loops", scores: { sent: 1 } });
  });
});
