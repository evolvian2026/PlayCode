import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "../db/client";
import { memberships, orgUnits, scimConnections, users } from "../db/schema";
import { audit } from "../lib/audit";
import { sha256 } from "../lib/crypto";
import { HttpError } from "../lib/errors";
import { revokeAll } from "./sessions";
import { importStudents } from "./students";
import { tenantUnits } from "./scope";

// SCIM 2.0 (RFC 7643/7644) so a college's identity provider (Entra ID, Okta,
// Google via a connector) keeps student accounts in step with its directory.
//
// - Users are the institution's students. New ones join the connection's
//   default batch; deleting or deactivating one disables the account and
//   signs it out. History is kept (erasure stays a privacy request).
// - Groups are org units, matched by name. A group the IdP creates becomes a
//   new batch. Group membership is student membership of the unit; the default
//   batch is the holding pen for students who belong to no other group.
// - Staff accounts are not managed here; they stay in the console.

export const SCIM = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  enterprise: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  list: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patch: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
} as const;

/** An error in SCIM's format, with its scimType (invalidFilter, uniqueness, ...). */
export class ScimError extends HttpError {
  constructor(
    status: number,
    detail: string,
    public scimType?: string,
  ) {
    super(status, scimType ?? "scim_error", detail);
  }
}

export interface ScimContext {
  db: Db;
  tenantId: string;
  defaultUnitId: string | null;
  now: Date;
  /** e.g. https://api.example.com/scim/v2, for meta.location. */
  baseUrl: string;
}

/** The connection a bearer token belongs to, or null. */
export async function scimConnectionFor(db: Db, token: string, now: Date) {
  if (!token) return null;
  const [c] = await db.select().from(scimConnections).where(eq(scimConnections.tokenHash, sha256(token)));
  if (!c) return null;
  // Note use at most once a minute; directories sync in bursts.
  if (!c.lastUsedAt || now.getTime() - c.lastUsedAt.getTime() > 60_000) {
    await db.update(scimConnections).set({ lastUsedAt: now }).where(eq(scimConnections.tenantId, c.tenantId));
  }
  return c;
}

// ---------- shared ----------

const MAX_PAGE = 500;
const listQuery = z.object({
  filter: z.string().max(500).optional(),
  startIndex: z.coerce.number().int().catch(1).default(1),
  count: z.coerce.number().int().catch(100).default(100),
  excludedAttributes: z.string().max(200).optional(),
});

function page(q: z.infer<typeof listQuery>) {
  const startIndex = Math.max(1, q.startIndex);
  return { startIndex, count: Math.min(MAX_PAGE, Math.max(0, q.count)) };
}

const listResponse = (resources: unknown[], total: number, startIndex: number) => ({
  schemas: [SCIM.list],
  totalResults: total,
  startIndex,
  itemsPerPage: resources.length,
  Resources: resources,
});

/** Parses the one filter shape identity providers send: `attribute eq "value"`. */
function parseFilter(filter: string | undefined, allowed: Record<string, string>): { field: string; value: string } | null {
  if (!filter?.trim()) return null;
  const m = filter.trim().match(/^([\w.:[\]" ]+?)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
  const field = m ? allowed[m[1]!.replace(/\s+/g, " ").toLowerCase()] : undefined;
  if (!m || !field) throw new ScimError(400, `Unsupported filter. Use one of: ${Object.keys(allowed).map((a) => `${a} eq "..."`).join(", ")}`, "invalidFilter");
  return { field, value: m[2]!.replace(/\\(.)/g, "$1") };
}

/** Entra sends booleans as "True"/"False" strings. */
function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && /^(true|false)$/i.test(v)) return v.toLowerCase() === "true";
  throw new ScimError(400, `Expected true or false, got ${JSON.stringify(v)}`, "invalidValue");
}

function str(v: unknown, what: string, max = 200): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new ScimError(400, `${what} must be a non-empty string`, "invalidValue");
  return v.trim();
}

const optStr = (v: unknown, what: string, max = 200) => (v === null || v === undefined || v === "" ? null : str(v, what, max));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const patchBody = z.object({
  Operations: z
    .array(z.object({ op: z.string().transform((s) => s.toLowerCase()).pipe(z.enum(["add", "replace", "remove"])), path: z.string().max(300).optional(), value: z.unknown().optional() }))
    .min(1)
    .max(100),
});

function parsePatch(body: unknown) {
  const r = patchBody.safeParse(body);
  if (!r.success) throw new ScimError(400, "A PATCH needs Operations: [{ op: add|replace|remove, path, value }]", "invalidSyntax");
  return r.data.Operations;
}

// ---------- Users ----------

/** Students of the institution: users with a student membership, not erased. */
const isStudentOf = (tenantId: string) =>
  and(eq(users.tenantId, tenantId), ne(users.status, "erased"), sql`exists (select 1 from ${memberships} m where m.user_id = ${users.id} and m.role = 'student')`);

type UserRow = typeof users.$inferSelect;

function splitName(name: string) {
  const i = name.indexOf(" ");
  return i < 0 ? { givenName: name, familyName: "" } : { givenName: name.slice(0, i), familyName: name.slice(i + 1) };
}

function userResource(ctx: ScimContext, u: UserRow, groups: { value: string; display: string }[]) {
  return {
    schemas: u.rollNo ? [SCIM.user, SCIM.enterprise] : [SCIM.user],
    id: u.id,
    externalId: u.scimExternalId ?? undefined,
    userName: u.email,
    displayName: u.name,
    name: { formatted: u.name, ...splitName(u.name) },
    emails: [{ value: u.email, type: "work", primary: true }],
    active: u.status === "active",
    groups: groups.map((g) => ({ ...g, $ref: `${ctx.baseUrl}/Groups/${g.value}` })),
    ...(u.rollNo ? { [SCIM.enterprise]: { employeeNumber: u.rollNo } } : {}),
    meta: { resourceType: "User", created: u.createdAt.toISOString(), lastModified: u.createdAt.toISOString(), location: `${ctx.baseUrl}/Users/${u.id}` },
  };
}

async function groupsOf(db: DbOrTx, userIds: string[]) {
  if (!userIds.length) return new Map<string, { value: string; display: string }[]>();
  const rows = await db
    .select({ userId: memberships.userId, id: orgUnits.id, name: orgUnits.name })
    .from(memberships)
    .innerJoin(orgUnits, eq(orgUnits.id, memberships.orgUnitId))
    .where(and(inArray(memberships.userId, userIds), eq(memberships.role, "student")));
  const map = new Map<string, { value: string; display: string }[]>();
  for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), { value: r.id, display: r.name }]);
  return map;
}

async function loadUser(ctx: ScimContext, id: string): Promise<UserRow> {
  if (!z.string().uuid().safeParse(id).success) throw new ScimError(404, "User not found");
  const [u] = await ctx.db.select().from(users).where(and(eq(users.id, id), isStudentOf(ctx.tenantId)));
  if (!u) throw new ScimError(404, "User not found");
  return u;
}

export async function getUser(ctx: ScimContext, id: string) {
  const u = await loadUser(ctx, id);
  return userResource(ctx, u, (await groupsOf(ctx.db, [u.id])).get(u.id) ?? []);
}

const USER_FILTERS: Record<string, string> = {
  username: "email",
  externalid: "externalId",
  id: "id",
  "emails.value": "email",
  'emails[type eq "work"].value': "email",
};

export async function listUsers(ctx: ScimContext, query: unknown) {
  const q = listQuery.parse(query);
  const { startIndex, count } = page(q);
  const f = parseFilter(q.filter, USER_FILTERS);
  const match =
    f?.field === "email"
      ? eq(users.email, f.value.toLowerCase())
      : f?.field === "externalId"
        ? eq(users.scimExternalId, f.value)
        : f?.field === "id"
          ? z.string().uuid().safeParse(f.value).success
            ? eq(users.id, f.value)
            : sql`false`
          : undefined;
  const where = and(isStudentOf(ctx.tenantId), match);
  const [{ total } = { total: 0 }] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
  const rows = count ? await ctx.db.select().from(users).where(where).orderBy(asc(users.createdAt), asc(users.id)).offset(startIndex - 1).limit(count) : [];
  const groups = await groupsOf(ctx.db, rows.map((u) => u.id));
  return listResponse(rows.map((u) => userResource(ctx, u, groups.get(u.id) ?? [])), total, startIndex);
}

interface UserFields {
  email: string;
  name: string;
  externalId: string | null;
  active: boolean;
  rollNo: string | null;
}

/** Reads a full User resource (POST and PUT). */
function readUser(body: unknown): UserFields {
  if (!isObj(body)) throw new ScimError(400, "Send a User resource", "invalidSyntax");
  const userName = str(body.userName, "userName");
  const emails = Array.isArray(body.emails) ? body.emails.filter(isObj) : [];
  const listed = (emails.find((e) => e.primary === true || e.primary === "True" || e.primary === "true") ?? emails[0])?.value;
  const email = z.string().email().safeParse(userName).success ? userName : str(listed, "A work email");
  const name = isObj(body.name) ? body.name : {};
  const full =
    optStr(body.displayName, "displayName") ??
    optStr(name.formatted, "name.formatted") ??
    ([optStr(name.givenName, "name.givenName"), optStr(name.familyName, "name.familyName")].filter(Boolean).join(" ") || email.split("@")[0]!);
  const ext = isObj(body[SCIM.enterprise]) ? (body[SCIM.enterprise] as Record<string, unknown>) : {};
  return {
    email,
    name: full,
    externalId: optStr(body.externalId, "externalId"),
    active: body.active === undefined ? true : bool(body.active),
    rollNo: optStr(ext.employeeNumber, "employeeNumber", 40),
  };
}

const fieldsOf = (u: UserRow): UserFields => ({ email: u.email, name: u.name, externalId: u.scimExternalId, active: u.status === "active", rollNo: u.rollNo });

export async function createUser(ctx: ScimContext, body: unknown) {
  const f = readUser(body);
  const email = f.email.toLowerCase();
  if (!z.string().email().safeParse(email).success) throw new ScimError(400, "userName must be an email address", "invalidValue");
  const [taken] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (taken) throw new ScimError(409, "A user with this userName already exists", "uniqueness");
  if (!ctx.defaultUnitId) throw new ScimError(400, "Choose a default batch for new students in PlayCode (Settings → Directory sync) before provisioning users.");
  const { created } = await importStudents(ctx.db, {
    tenantId: ctx.tenantId,
    actorId: null,
    unitId: ctx.defaultUnitId,
    rows: [{ name: f.name, email, rollNo: f.rollNo, phone: null }],
    now: ctx.now,
  });
  const id = created[0]!.id;
  await ctx.db.update(users).set({ scimExternalId: f.externalId, status: f.active ? "active" : "disabled" }).where(eq(users.id, id));
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: null, action: "scim.user.create", target: id, data: { email, externalId: f.externalId } });
  return getUser(ctx, id);
}

/** Saves changed fields; a deactivated account is signed out everywhere. */
async function saveUser(ctx: ScimContext, u: UserRow, next: UserFields, action: string) {
  const email = next.email.toLowerCase();
  if (!z.string().email().safeParse(email).success) throw new ScimError(400, "userName must be an email address", "invalidValue");
  if (email !== u.email) {
    const [taken] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken) throw new ScimError(409, "A user with this userName already exists", "uniqueness");
  }
  const before = fieldsOf(u);
  const changed = (Object.keys(before) as (keyof UserFields)[]).filter((k) => before[k] !== (k === "email" ? email : next[k]));
  if (changed.length) {
    await ctx.db
      .update(users)
      .set({ email, name: next.name, scimExternalId: next.externalId, rollNo: next.rollNo, status: next.active ? "active" : "disabled" })
      .where(eq(users.id, u.id));
    if (before.active && !next.active) await revokeAll(ctx.db, u.id, ctx.now);
    await audit(ctx.db, { tenantId: ctx.tenantId, actorId: null, action, target: u.id, data: { changed } });
  }
  return getUser(ctx, u.id);
}

export async function replaceUser(ctx: ScimContext, id: string, body: unknown) {
  return saveUser(ctx, await loadUser(ctx, id), readUser(body), "scim.user.update");
}

export async function patchUser(ctx: ScimContext, id: string, body: unknown) {
  const u = await loadUser(ctx, id);
  const next = fieldsOf(u);
  const apply = (op: string, path: string, value: unknown): void => {
    const p = path.replace(/\s+/g, " ").toLowerCase();
    const remove = op === "remove";
    if (p === "active") next.active = remove ? next.active : bool(value);
    else if (p === "username" || p === "emails.value" || p === 'emails[type eq "work"].value') next.email = remove ? next.email : str(value, "userName");
    else if (p === "emails" && Array.isArray(value)) {
      const e = value.filter(isObj).find((x) => x.primary === true || String(x.primary).toLowerCase() === "true") ?? value.filter(isObj)[0];
      if (e) next.email = str(e.value, "email");
    } else if (p === "displayname" || p === "name.formatted") next.name = remove ? next.name : str(value, "displayName");
    else if (p === "name.givenname" || p === "name.familyname") {
      if (remove) return;
      const parts = splitName(next.name);
      if (p === "name.givenname") parts.givenName = str(value, "givenName");
      else parts.familyName = str(value, "familyName");
      next.name = `${parts.givenName} ${parts.familyName}`.trim();
    } else if (p === "name" && isObj(value)) {
      if (value.formatted) next.name = str(value.formatted, "name.formatted");
      else for (const [k, v] of Object.entries(value)) apply(op, `name.${k}`, v);
    } else if (p === "externalid") next.externalId = remove ? null : optStr(value, "externalId");
    else if (p === `${SCIM.enterprise}:employeenumber`.toLowerCase()) next.rollNo = remove ? null : optStr(value, "employeeNumber", 40);
    else if (p === SCIM.enterprise.toLowerCase() && isObj(value) && "employeeNumber" in value) next.rollNo = optStr(value.employeeNumber, "employeeNumber", 40);
    // Anything else (title, phone numbers, addresses...) is accepted and ignored.
  };
  for (const op of parsePatch(body)) {
    if (op.path) apply(op.op, op.path, op.value);
    else if (op.op === "remove") throw new ScimError(400, "remove needs a path", "noTarget");
    else if (isObj(op.value)) for (const [k, v] of Object.entries(op.value)) apply(op.op, k, v);
    else throw new ScimError(400, "Without a path, value must be an object", "invalidValue");
  }
  return saveUser(ctx, u, next, "scim.user.update");
}

/** DELETE disables the account and signs it out; the student's history stays. */
export async function deleteUser(ctx: ScimContext, id: string) {
  const u = await loadUser(ctx, id);
  if (u.status === "active") {
    await ctx.db.update(users).set({ status: "disabled" }).where(eq(users.id, u.id));
    await revokeAll(ctx.db, u.id, ctx.now);
  }
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: null, action: "scim.user.deactivate", target: u.id });
}

// ---------- Groups ----------

type UnitRow = typeof orgUnits.$inferSelect;

async function membersOf(db: DbOrTx, unitIds: string[]) {
  const map = new Map<string, { value: string; display: string }[]>();
  if (!unitIds.length) return map;
  const rows = await db
    .select({ unitId: memberships.orgUnitId, id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(inArray(memberships.orgUnitId, unitIds), eq(memberships.role, "student"), ne(users.status, "erased")))
    .orderBy(asc(users.name));
  for (const r of rows) map.set(r.unitId!, [...(map.get(r.unitId!) ?? []), { value: r.id, display: r.name }]);
  return map;
}

function groupResource(ctx: ScimContext, unit: UnitRow, members: { value: string; display: string }[] | null) {
  return {
    schemas: [SCIM.group],
    id: unit.id,
    displayName: unit.name,
    ...(members ? { members: members.map((m) => ({ ...m, $ref: `${ctx.baseUrl}/Users/${m.value}` })) } : {}),
    meta: { resourceType: "Group", created: unit.createdAt.toISOString(), lastModified: unit.createdAt.toISOString(), location: `${ctx.baseUrl}/Groups/${unit.id}` },
  };
}

async function loadGroup(ctx: ScimContext, id: string): Promise<UnitRow> {
  if (!z.string().uuid().safeParse(id).success) throw new ScimError(404, "Group not found");
  const [unit] = await ctx.db.select().from(orgUnits).where(and(eq(orgUnits.id, id), eq(orgUnits.tenantId, ctx.tenantId)));
  if (!unit) throw new ScimError(404, "Group not found");
  return unit;
}

const wantsMembers = (excluded?: string) => !excluded?.split(",").some((a) => a.trim().toLowerCase() === "members");

export async function getGroup(ctx: ScimContext, id: string, query: unknown = {}) {
  const unit = await loadGroup(ctx, id);
  const withMembers = wantsMembers(listQuery.parse(query).excludedAttributes);
  return groupResource(ctx, unit, withMembers ? ((await membersOf(ctx.db, [unit.id])).get(unit.id) ?? []) : null);
}

export async function listGroups(ctx: ScimContext, query: unknown) {
  const q = listQuery.parse(query);
  const { startIndex, count } = page(q);
  const f = parseFilter(q.filter, { displayname: "displayName", id: "id" });
  let units = (await tenantUnits(ctx.db, ctx.tenantId)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  if (f?.field === "displayName") units = units.filter((u) => u.name.toLowerCase() === f.value.toLowerCase());
  if (f?.field === "id") units = units.filter((u) => u.id === f.value);
  const slice = units.slice(startIndex - 1, startIndex - 1 + count);
  const members = wantsMembers(q.excludedAttributes) ? await membersOf(ctx.db, slice.map((u) => u.id)) : null;
  return listResponse(slice.map((u) => groupResource(ctx, u, members ? (members.get(u.id) ?? []) : null)), units.length, startIndex);
}

/** Member ids from [{ value }] (or a bare id); each must be one of the institution's students. */
async function memberIds(ctx: ScimContext, value: unknown): Promise<string[]> {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const ids = [...new Set(list.map((m) => (isObj(m) ? m.value : m)).map((v) => str(v, "members.value", 100)))];
  if (!ids.length) return [];
  const valid = ids.filter((id) => z.string().uuid().safeParse(id).success);
  const found = valid.length ? await ctx.db.select({ id: users.id }).from(users).where(and(inArray(users.id, valid), isStudentOf(ctx.tenantId))) : [];
  const unknown = ids.filter((id) => !found.some((f) => f.id === id));
  if (unknown.length) throw new ScimError(400, `Not students of this institution: ${unknown.slice(0, 5).join(", ")}`, "invalidValue");
  return ids;
}

/** Adds students to a unit. Students who were only in the default batch move out of it. */
async function addMembers(ctx: ScimContext, tx: DbOrTx, unitId: string, ids: string[]) {
  if (!ids.length) return;
  const have = new Set(
    (await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgUnitId, unitId), eq(memberships.role, "student"), inArray(memberships.userId, ids)))).map((m) => m.userId),
  );
  const toAdd = ids.filter((id) => !have.has(id));
  if (toAdd.length) await tx.insert(memberships).values(toAdd.map((userId) => ({ userId, tenantId: ctx.tenantId, orgUnitId: unitId, role: "student" as const })));
  if (ctx.defaultUnitId && ctx.defaultUnitId !== unitId) {
    await tx.delete(memberships).where(and(eq(memberships.orgUnitId, ctx.defaultUnitId), eq(memberships.role, "student"), inArray(memberships.userId, ids)));
  }
}

/** Removes students from a unit. Anyone left in no unit goes back to the default batch (or stays, if there is none). */
async function removeMembers(ctx: ScimContext, tx: DbOrTx, unitId: string, ids: string[]) {
  if (!ids.length) return;
  const others = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(inArray(memberships.userId, ids), eq(memberships.role, "student"), ne(memberships.orgUnitId, unitId)));
  const homeless = ids.filter((id) => !others.some((o) => o.userId === id));
  // Leaving the default batch itself only works for students who have another unit.
  const fallback = ctx.defaultUnitId && ctx.defaultUnitId !== unitId ? ctx.defaultUnitId : null;
  const leaving = fallback ? ids : ids.filter((id) => !homeless.includes(id));
  if (leaving.length) await tx.delete(memberships).where(and(eq(memberships.orgUnitId, unitId), eq(memberships.role, "student"), inArray(memberships.userId, leaving)));
  if (fallback && homeless.length) await addMembers(ctx, tx, fallback, homeless);
}

async function setMembers(ctx: ScimContext, tx: DbOrTx, unitId: string, ids: string[]) {
  const current = ((await membersOf(tx, [unitId])).get(unitId) ?? []).map((m) => m.value);
  await removeMembers(ctx, tx, unitId, current.filter((id) => !ids.includes(id)));
  await addMembers(ctx, tx, unitId, ids.filter((id) => !current.includes(id)));
}

async function assertNameFree(ctx: ScimContext, name: string, except?: string) {
  const clash = (await tenantUnits(ctx.db, ctx.tenantId)).find((u) => u.name.toLowerCase() === name.toLowerCase() && u.id !== except);
  if (clash) throw new ScimError(409, `A group named "${name}" already exists`, "uniqueness");
}

export async function createGroup(ctx: ScimContext, body: unknown) {
  if (!isObj(body)) throw new ScimError(400, "Send a Group resource", "invalidSyntax");
  const name = str(body.displayName, "displayName", 120);
  await assertNameFree(ctx, name);
  const ids = await memberIds(ctx, body.members);
  const unit = await ctx.db.transaction(async (tx) => {
    const [unit] = await tx.insert(orgUnits).values({ tenantId: ctx.tenantId, kind: "batch", name }).returning();
    await addMembers(ctx, tx, unit!.id, ids);
    return unit!;
  });
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: null, action: "scim.group.create", target: unit.id, data: { name, members: ids.length } });
  return getGroup(ctx, unit.id);
}

export async function replaceGroup(ctx: ScimContext, id: string, body: unknown) {
  const unit = await loadGroup(ctx, id);
  if (!isObj(body)) throw new ScimError(400, "Send a Group resource", "invalidSyntax");
  const name = str(body.displayName, "displayName", 120);
  if (name !== unit.name) await assertNameFree(ctx, name, unit.id);
  const ids = await memberIds(ctx, body.members);
  await ctx.db.transaction(async (tx) => {
    if (name !== unit.name) await tx.update(orgUnits).set({ name }).where(eq(orgUnits.id, unit.id));
    await setMembers(ctx, tx, unit.id, ids);
  });
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: null, action: "scim.group.update", target: unit.id, data: { name, members: ids.length } });
  return getGroup(ctx, unit.id);
}

export async function patchGroup(ctx: ScimContext, id: string, body: unknown) {
  const unit = await loadGroup(ctx, id);
  const ops = parsePatch(body);
  let name = unit.name;
  const steps: { kind: "add" | "remove" | "set" | "clear"; ids: string[] }[] = [];
  const member = (op: string, value: unknown, ids: string[]) => {
    if (op === "add") steps.push({ kind: "add", ids });
    else if (op === "replace") steps.push({ kind: "set", ids });
    else steps.push({ kind: value === undefined ? "clear" : "remove", ids });
  };
  for (const op of ops) {
    const path = op.path?.replace(/\s+/g, " ").trim();
    const filtered = path?.match(/^members\[value eq "([^"]+)"\]$/i);
    if (filtered) {
      if (op.op !== "remove") throw new ScimError(400, "Only remove is supported on a filtered members path", "invalidPath");
      steps.push({ kind: "remove", ids: await memberIds(ctx, filtered[1]) });
    } else if (path?.toLowerCase() === "members") member(op.op, op.value, await memberIds(ctx, op.value));
    else if (path?.toLowerCase() === "displayname") name = str(op.value, "displayName", 120);
    else if (!path && isObj(op.value)) {
      if (op.value.displayName !== undefined) name = str(op.value.displayName, "displayName", 120);
      if (op.value.members !== undefined) member(op.op, op.value.members, await memberIds(ctx, op.value.members));
    } else if (!path) throw new ScimError(400, "Without a path, value must be an object", "invalidValue");
    else if (path.toLowerCase() !== "externalid") throw new ScimError(400, `Unsupported path: ${path}`, "invalidPath");
  }
  if (name !== unit.name) await assertNameFree(ctx, name, unit.id);
  await ctx.db.transaction(async (tx) => {
    if (name !== unit.name) await tx.update(orgUnits).set({ name }).where(eq(orgUnits.id, unit.id));
    for (const s of steps) {
      if (s.kind === "add") await addMembers(ctx, tx, unit.id, s.ids);
      else if (s.kind === "remove") await removeMembers(ctx, tx, unit.id, s.ids);
      else if (s.kind === "set") await setMembers(ctx, tx, unit.id, s.ids);
      else await setMembers(ctx, tx, unit.id, []);
    }
  });
  await audit(ctx.db, {
    tenantId: ctx.tenantId,
    actorId: null,
    action: "scim.group.update",
    target: unit.id,
    data: { renamed: name !== unit.name, ...Object.fromEntries(steps.map((s) => [s.kind, s.ids.length])) },
  });
  return getGroup(ctx, unit.id);
}

/** DELETE empties the group but keeps the unit: assignments, reports and history still point at it. */
export async function deleteGroup(ctx: ScimContext, id: string) {
  const unit = await loadGroup(ctx, id);
  await ctx.db.transaction((tx) => setMembers(ctx, tx, unit.id, []));
  await audit(ctx.db, { tenantId: ctx.tenantId, actorId: null, action: "scim.group.delete", target: unit.id });
}

// ---------- Discovery ----------

export function serviceProviderConfig(baseUrl: string) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_PAGE },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "The token from PlayCode's console (Settings → Directory sync)", primary: true }],
    meta: { resourceType: "ServiceProviderConfig", location: `${baseUrl}/ServiceProviderConfig` },
  };
}

export function resourceTypes(baseUrl: string) {
  const types = [
    { id: "User", name: "User", endpoint: "/Users", schema: SCIM.user, schemaExtensions: [{ schema: SCIM.enterprise, required: false }] },
    { id: "Group", name: "Group", endpoint: "/Groups", schema: SCIM.group, schemaExtensions: [] },
  ].map((t) => ({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], ...t, meta: { resourceType: "ResourceType", location: `${baseUrl}/ResourceTypes/${t.id}` } }));
  return listResponse(types, types.length, 1);
}
