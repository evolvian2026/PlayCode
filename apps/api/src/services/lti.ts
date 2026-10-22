import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { createRemoteJWKSet, exportJWK, exportPKCS8, generateKeyPair, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import type { Db, DbOrTx } from "../db/client";
import { assignments, ltiAccounts, ltiDeepLinks, ltiKeys, ltiLinks, ltiNonces, ltiPlatforms, ltiScores, memberships, users } from "../db/schema";
import { env } from "../env";
import { audit } from "../lib/audit";
import { signToken } from "../lib/auth";
import { decrypt, encrypt, sha256 } from "../lib/crypto";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { importStudents } from "./students";
import { assertPublicUrl } from "./webhooks";
import { hasFeature } from "./plan";

// LTI 1.3 tool: an LMS (Moodle, Canvas, Blackboard, D2L) launches PlayCode
// assignments from inside a course, signs the student in, and receives the
// score in its gradebook (Assignment and Grade Services).
//
// Flow: the LMS calls /lti/login (third-party initiated login), we redirect
// back to its OIDC endpoint with a nonce and an encrypted state, and it posts
// a signed id_token to /lti/launch. Grades go back with an OAuth2 client
// credentials token obtained using a JWT signed by our key (/lti/jwks).

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const AGS_CLAIM = "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";
const DL = "https://purl.imsglobal.org/spec/lti-dl/claim/";
const DL_SETTINGS = `${DL}deep_linking_settings`;
export const SCORE_SCOPE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
const STATE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 7;

const base = () => env.API_PUBLIC_URL.replace(/\/$/, "");
export const toolUrls = () => ({ loginUrl: `${base()}/lti/login`, launchUrl: `${base()}/lti/launch`, jwksUrl: `${base()}/lti/jwks` });

type Platform = typeof ltiPlatforms.$inferSelect;

// ---------- Tool keys ----------

async function signingKey(db: Db) {
  let [k] = await db.select().from(ltiKeys).orderBy(asc(ltiKeys.createdAt)).limit(1);
  if (!k) {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const kid = randomBytes(8).toString("hex");
    await db
      .insert(ltiKeys)
      .values({ kid, publicJwk: { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" }, privateKeyEnc: encrypt(await exportPKCS8(privateKey)) })
      .onConflictDoNothing();
    [k] = await db.select().from(ltiKeys).orderBy(asc(ltiKeys.createdAt)).limit(1);
  }
  return { kid: k!.kid, key: await importPKCS8(decrypt(k!.privateKeyEnc), "RS256") };
}

export async function publicJwks(db: Db) {
  await signingKey(db);
  return { keys: (await db.select({ jwk: ltiKeys.publicJwk }).from(ltiKeys)).map((r) => r.jwk) };
}

// ---------- Platforms ----------

export interface PlatformInput {
  name: string;
  issuer: string;
  clientId: string;
  deploymentIds: string[];
  authLoginUrl: string;
  authTokenUrl: string;
  jwksUrl: string;
  autoProvisionUnitId: string | null;
  enabled: boolean;
}

export async function listPlatforms(db: Db, tenantId: string) {
  return db.select().from(ltiPlatforms).where(eq(ltiPlatforms.tenantId, tenantId)).orderBy(asc(ltiPlatforms.createdAt));
}

export async function savePlatform(db: Db, tenantId: string, actorId: string, input: PlatformInput, id?: string) {
  for (const url of [input.issuer, input.authLoginUrl, input.authTokenUrl, input.jwksUrl]) await assertPublicUrl(url);
  const values = { ...input, issuer: input.issuer.replace(/\/$/, ""), deploymentIds: input.deploymentIds.map((d) => d.trim()).filter(Boolean) };
  const [clash] = await db.select().from(ltiPlatforms).where(and(eq(ltiPlatforms.issuer, values.issuer), eq(ltiPlatforms.clientId, values.clientId)));
  if (clash && clash.id !== id) throw badRequest("This LMS and client ID are already registered");
  let row;
  if (id) {
    [row] = await db.update(ltiPlatforms).set(values).where(and(eq(ltiPlatforms.id, id), eq(ltiPlatforms.tenantId, tenantId))).returning();
    if (!row) throw notFound("LMS");
  } else {
    [row] = await db.insert(ltiPlatforms).values({ ...values, tenantId }).returning();
  }
  jwksCache.delete(row!.jwksUrl);
  await audit(db, { tenantId, actorId, action: id ? "lti.platform_update" : "lti.platform_add", target: row!.id, data: { name: values.name, issuer: values.issuer } });
  return row!;
}

export async function deletePlatform(db: Db, tenantId: string, actorId: string, id: string) {
  const [row] = await db.delete(ltiPlatforms).where(and(eq(ltiPlatforms.id, id), eq(ltiPlatforms.tenantId, tenantId))).returning();
  if (!row) throw notFound("LMS");
  await audit(db, { tenantId, actorId, action: "lti.platform_remove", target: id, data: { name: row.name } });
}

// ---------- Launch ----------

/** Step 1 (third-party initiated login): send the browser back to the LMS's OIDC endpoint. */
export async function startLaunch(db: Db, p: Record<string, string | undefined>, now: Date) {
  if (!p.iss || !p.login_hint) throw badRequest("Missing iss or login_hint");
  const candidates = (await db.select().from(ltiPlatforms).where(and(eq(ltiPlatforms.issuer, p.iss.replace(/\/$/, "")), eq(ltiPlatforms.enabled, true)))).filter(
    (x) => !p.client_id || x.clientId === p.client_id,
  );
  if (candidates.length === 0) throw badRequest("This LMS is not registered with PlayCode. Ask your PlayCode admin to add it under Settings.");
  if (candidates.length > 1) throw badRequest("Several PlayCode registrations match this LMS; it must send client_id");
  const platform = candidates[0]!;
  if (!(await hasFeature(db, platform.tenantId, "lti"))) throw badRequest("LMS integration is not included in this institution's PlayCode plan");
  const nonce = randomBytes(16).toString("base64url");
  const state = encrypt(JSON.stringify({ p: platform.id, n: nonce, exp: now.getTime() + STATE_TTL_MS }));
  const url = new URL(platform.authLoginUrl);
  const params = new URLSearchParams({
    scope: "openid",
    response_type: "id_token",
    response_mode: "form_post",
    prompt: "none",
    client_id: platform.clientId,
    redirect_uri: toolUrls().launchUrl,
    login_hint: p.login_hint,
    state,
    nonce,
  });
  if (p.lti_message_hint) params.set("lti_message_hint", p.lti_message_hint);
  url.search = params.toString();
  return url.toString();
}

const jwksCache = new Map<string, JWTVerifyGetKey>();
const keySet = (url: string) => {
  let ks = jwksCache.get(url);
  if (!ks) jwksCache.set(url, (ks = createRemoteJWKSet(new URL(url))));
  return ks;
};

const isInstructor = (roles: string[]) => roles.some((r) => /#(Instructor|Administrator|ContentDeveloper|TeachingAssistant|Mentor)$/.test(r));

/** Step 2: verify the LMS's signed launch, sign the user in, and work out where to send them. */
export async function finishLaunch(db: Db, form: { id_token?: string; state?: string }, now: Date) {
  if (!form.id_token || !form.state) throw badRequest("The LMS did not send a launch");
  let st: { p: string; n: string; exp: number };
  try {
    st = JSON.parse(decrypt(form.state));
  } catch {
    throw badRequest("The launch is invalid. Open the activity from your course again.");
  }
  if (now.getTime() > st.exp) throw badRequest("The launch took too long. Open the activity from your course again.");
  const [platform] = await db.select().from(ltiPlatforms).where(eq(ltiPlatforms.id, st.p));
  if (!platform?.enabled) throw badRequest("This LMS is no longer connected to PlayCode");

  const { payload: c } = await jwtVerify(form.id_token, keySet(platform.jwksUrl), { issuer: platform.issuer, audience: platform.clientId, currentDate: now }).catch(() => {
    throw forbidden("Could not verify the launch from your LMS");
  });
  if (Array.isArray(c.aud) && c.aud.length > 1 && c.azp !== platform.clientId) throw forbidden("Could not verify the launch from your LMS");
  if (c.nonce !== st.n) throw forbidden("Could not verify the launch from your LMS");
  // Each launch works once.
  await db.delete(ltiNonces).where(lt(ltiNonces.expiresAt, now));
  const fresh = await db.insert(ltiNonces).values({ nonce: st.n, expiresAt: new Date(now.getTime() + STATE_TTL_MS) }).onConflictDoNothing().returning();
  if (fresh.length === 0) throw forbidden("This launch was already used. Open the activity from your course again.");

  const claim = <T>(name: string) => c[`${CLAIM}${name}`] as T | undefined;
  if (claim<string>("version") !== "1.3.0") throw badRequest("Only LTI 1.3 launches are supported");
  const messageType = claim<string>("message_type");
  if (messageType !== "LtiResourceLinkRequest" && messageType !== "LtiDeepLinkingRequest") throw badRequest("PlayCode does not support this kind of LMS launch");
  const deployment = claim<string>("deployment_id");
  if (!deployment || (platform.deploymentIds.length > 0 && !platform.deploymentIds.includes(deployment))) throw forbidden("This LMS deployment is not allowed");
  const sub = String(c.sub ?? "");
  if (!sub) throw badRequest("The launch has no user");
  const roles = claim<string[]>("roles") ?? [];
  const instructor = isInstructor(roles);

  if (messageType === "LtiDeepLinkingRequest") {
    // A teacher adding PlayCode to a course: let them pick assignments, then post the choice back.
    if (!instructor) throw forbidden("Only teachers can add PlayCode activities to a course");
    const settings = c[DL_SETTINGS] as { deep_link_return_url?: string; accept_types?: string[]; accept_multiple?: boolean; data?: string } | undefined;
    if (!settings?.deep_link_return_url) throw badRequest("The LMS did not say where to return the selection");
    if (settings.accept_types && !settings.accept_types.includes("ltiResourceLink")) throw badRequest("The LMS does not accept activity links here");
    const userId = await resolveUser(db, platform, { sub, email: typeof c.email === "string" ? c.email : null, name: typeof c.name === "string" ? c.name : null, instructor, now });
    const [req] = await db
      .insert(ltiDeepLinks)
      .values({ platformId: platform.id, userId, deploymentId: deployment, returnUrl: settings.deep_link_return_url, data: settings.data ?? null, acceptMultiple: Boolean(settings.accept_multiple), expiresAt: new Date(now.getTime() + 60 * 60_000), createdAt: now })
      .returning();
    return { token: await tokenFor(db, userId), next: `/console/lti/pick?request=${req!.id}` };
  }

  const resource = claim<{ id: string; title?: string }>("resource_link");
  if (!resource?.id) throw badRequest("The launch has no activity");
  const context = claim<{ title?: string }>("context");
  const custom = claim<Record<string, string>>("custom") ?? {};
  const ags = c[AGS_CLAIM] as { scope?: string[]; lineitem?: string } | undefined;

  const userId = await resolveUser(db, platform, { sub, email: typeof c.email === "string" ? c.email : null, name: typeof c.name === "string" ? c.name : null, instructor, now });

  // The activity: bound to an assignment by the teacher, or by a custom parameter set in the LMS.
  let assignmentId: string | null = null;
  if (custom.assignment_id) {
    const [a] = await db.select({ id: assignments.id }).from(assignments).where(and(sql`${assignments.id}::text = ${custom.assignment_id}`, eq(assignments.tenantId, platform.tenantId)));
    if (a) assignmentId = a.id;
  }
  const linkValues = {
    title: resource.title ?? null,
    contextTitle: context?.title ?? null,
    lineitemUrl: ags?.lineitem ?? null,
    agsScopes: ags?.scope ?? [],
    ...(assignmentId ? { assignmentId } : {}),
  };
  const [link] = await db
    .insert(ltiLinks)
    .values({ platformId: platform.id, resourceLinkId: resource.id, ...linkValues })
    .onConflictDoUpdate({ target: [ltiLinks.platformId, ltiLinks.resourceLinkId], set: linkValues })
    .returning();

  await audit(db, { tenantId: platform.tenantId, actorId: userId, action: "lti.launch", target: link!.id, data: { platform: platform.name, instructor } });
  const token = await tokenFor(db, userId);

  if (instructor) return { token, next: link!.assignmentId ? "/console/assignments" : `/console/lti/link?id=${link!.id}` };
  if (!link!.assignmentId) throw badRequest("Your teacher has not connected this activity to a PlayCode assignment yet");
  return { token, next: `/play/start?assignment=${link!.assignmentId}` };
}

async function tokenFor(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const roles = [...new Set((await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId))).map((r) => r.role))];
  return signToken({ sub: userId, tenantId: user!.tenantId, roles });
}

async function resolveUser(db: Db, platform: Platform, u: { sub: string; email: string | null; name: string | null; instructor: boolean; now: Date }) {
  const check = async (userId: string) => {
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    if (!row || row.tenantId !== platform.tenantId) throw forbidden("Your PlayCode account belongs to another institution");
    if (row.status !== "active") throw forbidden("Your PlayCode account is disabled");
    const roles = (await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId))).map((r) => r.role);
    if (u.instructor && roles.every((r) => r === "student")) throw forbidden("Your PlayCode account is a student account");
    return userId;
  };
  const [linked] = await db.select().from(ltiAccounts).where(and(eq(ltiAccounts.platformId, platform.id), eq(ltiAccounts.sub, u.sub)));
  if (linked) return check(linked.userId);

  let userId: string | undefined;
  const email = u.email?.toLowerCase() ?? null;
  if (email) userId = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]?.id;
  if (userId) await check(userId);
  else {
    if (u.instructor) throw forbidden("Teachers need a PlayCode account with the same email as in the LMS. Ask your PlayCode admin.");
    if (!platform.autoProvisionUnitId) throw forbidden("There is no PlayCode account for you yet. Ask your teacher to add you.");
    // Some LMSs withhold email; such students get a placeholder address tied to their LMS identity.
    const address = email ?? `lti-${sha256(`${platform.id}:${u.sub}`).slice(0, 16)}@lti.invalid`;
    const res = await importStudents(db, { tenantId: platform.tenantId, actorId: null, unitId: platform.autoProvisionUnitId, rows: [{ name: u.name ?? "Student", email: address, rollNo: null, phone: null }], now: u.now });
    userId = res.created[0]?.id;
    if (!userId) throw forbidden("Could not create your PlayCode account. Ask your teacher.");
  }
  await db.insert(ltiAccounts).values({ platformId: platform.id, sub: u.sub, userId }).onConflictDoNothing();
  return userId;
}

// ---------- Deep linking: the teacher picks content inside the LMS ----------

async function loadDeepLink(db: Db, tenantId: string, userId: string, id: string, now: Date) {
  const [row] = await db
    .select({ req: ltiDeepLinks, platform: ltiPlatforms })
    .from(ltiDeepLinks)
    .innerJoin(ltiPlatforms, eq(ltiPlatforms.id, ltiDeepLinks.platformId))
    .where(and(eq(ltiDeepLinks.id, id), eq(ltiPlatforms.tenantId, tenantId)));
  if (!row || row.req.userId !== userId) throw notFound("Selection request");
  if (row.req.usedAt) throw badRequest("This selection was already sent to the LMS. Start again from your course.");
  if (row.req.expiresAt < now) throw badRequest("This selection has expired. Start again from your course.");
  return row;
}

export async function deepLinkDetail(db: Db, tenantId: string, userId: string, id: string, now: Date) {
  const { req, platform } = await loadDeepLink(db, tenantId, userId, id, now);
  return { id: req.id, platform: platform.name, acceptMultiple: req.acceptMultiple };
}

/**
 * Build the signed LtiDeepLinkingResponse for the chosen assignments. The
 * browser posts it to the LMS, which creates one activity (with a gradebook
 * column) per assignment; each launches with custom assignment_id.
 */
export async function completeDeepLink(db: Db, tenantId: string, userId: string, id: string, assignmentIds: string[], now: Date) {
  const { req, platform } = await loadDeepLink(db, tenantId, userId, id, now);
  if (assignmentIds.length === 0) throw badRequest("Choose an assignment");
  if (assignmentIds.length > 1 && !req.acceptMultiple) throw badRequest("Your LMS accepts one activity at a time here");
  const chosen = await db.select().from(assignments).where(and(inArray(assignments.id, assignmentIds), eq(assignments.tenantId, tenantId)));
  if (chosen.length !== new Set(assignmentIds).size) throw notFound("Assignment");
  const { kid, key } = await signingKey(db);
  const iat = Math.floor(now.getTime() / 1000);
  const jwt = await new SignJWT({
    nonce: randomBytes(16).toString("hex"),
    [`${CLAIM}message_type`]: "LtiDeepLinkingResponse",
    [`${CLAIM}version`]: "1.3.0",
    [`${CLAIM}deployment_id`]: req.deploymentId,
    [`${DL}content_items`]: assignmentIds.map((aid) => {
      const a = chosen.find((x) => x.id === aid)!;
      return {
        type: "ltiResourceLink",
        title: a.title,
        text: `PlayCode assignment: ${a.questionIds.length} questions`,
        url: toolUrls().launchUrl,
        custom: { assignment_id: a.id },
        lineItem: { label: a.title, scoreMaximum: a.questionIds.length, resourceId: a.id },
      };
    }),
    ...(req.data ? { [`${DL}data`]: req.data } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuer(platform.clientId)
    .setAudience(platform.issuer)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 600)
    .sign(key);
  await db.update(ltiDeepLinks).set({ usedAt: now }).where(eq(ltiDeepLinks.id, req.id));
  await audit(db, { tenantId, actorId: userId, action: "lti.deep_link", target: req.id, data: { assignments: assignmentIds } });
  return { returnUrl: req.returnUrl, jwt };
}

// ---------- Teacher binding an activity ----------

export async function linkDetail(db: Db, tenantId: string, linkId: string) {
  const [row] = await db
    .select({ link: ltiLinks, platform: ltiPlatforms.name })
    .from(ltiLinks)
    .innerJoin(ltiPlatforms, eq(ltiPlatforms.id, ltiLinks.platformId))
    .where(and(eq(ltiLinks.id, linkId), eq(ltiPlatforms.tenantId, tenantId)));
  if (!row) throw notFound("Activity");
  return { id: row.link.id, title: row.link.title, course: row.link.contextTitle, platform: row.platform, assignmentId: row.link.assignmentId, gradebook: Boolean(row.link.lineitemUrl && row.link.agsScopes.includes(SCORE_SCOPE)) };
}

export async function bindLink(db: Db, tenantId: string, actorId: string, linkId: string, assignmentId: string) {
  await linkDetail(db, tenantId, linkId);
  const [a] = await db.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.id, assignmentId), eq(assignments.tenantId, tenantId)));
  if (!a) throw notFound("Assignment");
  await db.update(ltiLinks).set({ assignmentId }).where(eq(ltiLinks.id, linkId));
  await audit(db, { tenantId, actorId, action: "lti.link_bound", target: linkId, data: { assignmentId } });
  return linkDetail(db, tenantId, linkId);
}

export async function listLinks(db: Db, tenantId: string) {
  const rows = await db
    .select({ link: ltiLinks, platform: ltiPlatforms.name, assignment: assignments.title })
    .from(ltiLinks)
    .innerJoin(ltiPlatforms, eq(ltiPlatforms.id, ltiLinks.platformId))
    .leftJoin(assignments, eq(assignments.id, ltiLinks.assignmentId))
    .where(eq(ltiPlatforms.tenantId, tenantId))
    .orderBy(asc(ltiLinks.createdAt));
  const ids = rows.map((r) => r.link.id);
  const counts = ids.length
    ? await db
        .select({ linkId: ltiScores.linkId, status: ltiScores.status, n: sql<number>`count(*)::int` })
        .from(ltiScores)
        .where(inArray(ltiScores.linkId, ids))
        .groupBy(ltiScores.linkId, ltiScores.status)
    : [];
  return rows.map((r) => ({
    id: r.link.id,
    title: r.link.title,
    course: r.link.contextTitle,
    platform: r.platform,
    assignmentId: r.link.assignmentId,
    assignment: r.assignment,
    gradebook: Boolean(r.link.lineitemUrl && r.link.agsScopes.includes(SCORE_SCOPE)),
    scores: Object.fromEntries(counts.filter((c) => c.linkId === r.link.id).map((c) => [c.status, c.n])),
  }));
}

// ---------- Grade passback ----------

/** Queue the score for every LMS activity bound to this assignment that the student launched from (inside the answer's transaction). */
export async function queueLtiScores(tx: DbOrTx, args: { assignmentId: string; userId: string; correct: number; total: number; now: Date }) {
  const rows = await tx
    .select({ linkId: ltiLinks.id, sub: ltiAccounts.sub, lineitem: ltiLinks.lineitemUrl, scopes: ltiLinks.agsScopes })
    .from(ltiLinks)
    .innerJoin(ltiAccounts, and(eq(ltiAccounts.platformId, ltiLinks.platformId), eq(ltiAccounts.userId, args.userId)))
    .where(eq(ltiLinks.assignmentId, args.assignmentId));
  const due = rows.filter((r) => r.lineitem && r.scopes.includes(SCORE_SCOPE));
  if (due.length === 0) return 0;
  await tx.insert(ltiScores).values(
    due.map((r) => ({ linkId: r.linkId, userId: args.userId, ltiSub: r.sub, scoreGiven: args.correct, scoreMaximum: args.total, nextAttemptAt: args.now, createdAt: args.now })),
  );
  return due.length;
}

const tokenCache = new Map<string, { token: string; until: number }>();

async function platformToken(db: Db, platform: Platform, now: Date, fetchImpl: typeof fetch) {
  const cached = tokenCache.get(platform.id);
  if (cached && cached.until > now.getTime() + 30_000) return cached.token;
  const { kid, key } = await signingKey(db);
  const iat = Math.floor(now.getTime() / 1000);
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(platform.clientId)
    .setSubject(platform.clientId)
    .setAudience(platform.authTokenUrl)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .setJti(randomBytes(12).toString("hex"))
    .sign(key);
  const res = await fetchImpl(platform.authTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
      scope: SCORE_SCOPE,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("token endpoint returned no access_token");
  tokenCache.set(platform.id, { token: body.access_token, until: now.getTime() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

/** The line item's scores endpoint: the line item URL with /scores added to its path. */
export function scoresUrl(lineitem: string): string {
  const u = new URL(lineitem);
  u.pathname = `${u.pathname.replace(/\/$/, "")}/scores`;
  return u.toString();
}

/** Send due scores. Safe to run concurrently: rows are claimed with a lease, like webhooks. */
export async function deliverLtiScores(db: Db, now: Date, opts: { limit?: number; fetchImpl?: typeof fetch } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const lease = new Date(now.getTime() + 5 * 60_000);
  const claimed = await db.execute<{ id: string }>(sql`
    update ${ltiScores} set next_attempt_at = ${lease}
    where id in (
      select id from ${ltiScores} where status = 'pending' and next_attempt_at <= ${now}
      order by next_attempt_at limit ${opts.limit ?? 100} for update skip locked
    )
    returning id`);
  const ids = claimed.rows.map((r) => r.id);
  if (ids.length === 0) return { sent: 0, failed: 0 };
  const rows = await db
    .select({ s: ltiScores, link: ltiLinks, platform: ltiPlatforms })
    .from(ltiScores)
    .innerJoin(ltiLinks, eq(ltiLinks.id, ltiScores.linkId))
    .innerJoin(ltiPlatforms, eq(ltiPlatforms.id, ltiLinks.platformId))
    .where(inArray(ltiScores.id, ids));
  let sent = 0;
  let failed = 0;
  for (const { s, link, platform } of rows) {
    const attempts = s.attempts + 1;
    try {
      if (!link.lineitemUrl) throw new Error("the activity has no gradebook column");
      await assertPublicUrl(link.lineitemUrl);
      const token = await platformToken(db, platform, now, fetchImpl);
      const res = await fetchImpl(scoresUrl(link.lineitemUrl), {
        method: "POST",
        headers: { "content-type": "application/vnd.ims.lis.v1.score+json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId: s.ltiSub,
          scoreGiven: s.scoreGiven,
          scoreMaximum: s.scoreMaximum,
          activityProgress: "Completed",
          gradingProgress: "FullyGraded",
          timestamp: s.createdAt.toISOString(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) tokenCache.delete(platform.id);
      if (!res.ok) throw new Error(`gradebook returned ${res.status}`);
      await db.update(ltiScores).set({ status: "sent", attempts, sentAt: now, lastError: null }).where(eq(ltiScores.id, s.id));
      sent++;
    } catch (err) {
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db
        .update(ltiScores)
        .set({ status: giveUp ? "failed" : "pending", attempts, lastError: (err as Error).message.slice(0, 300), nextAttemptAt: new Date(now.getTime() + 2 ** (attempts - 1) * 60_000) })
        .where(eq(ltiScores.id, s.id));
      if (giveUp) failed++;
    }
  }
  return { sent, failed };
}
