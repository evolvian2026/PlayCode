import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { documentSubmissions, notifications, users } from "../src/db/schema";
import { getObject } from "../src/lib/storage";
import { documentReminders } from "../src/services/documents";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let riya: string;
let kavya: string;
let unitA: string;
let id: string;
let riyaId: string;
const HOUR = 3_600_000;
const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2000, 32), Buffer.from("\n%%EOF")]);
const b64 = (b: Buffer) => b.toString("base64");
const raw = (token: string, url: string) => t.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  kavya = await t.login("kavya.singh8@demo.edu");
  unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("document collection", () => {
  it("asks a batch for a document by a date, and tells them", async () => {
    expect((await t.post(tpo, "/console/documents", { title: "Semester 1-6 marksheets", unitIds: [unitA], dueOn: "2026-10-01" })).status).toBe(400);
    const res = await t.post(faculty, "/console/documents", { title: "Semester 1-6 marksheets", instructions: "One PDF with all six marksheets, in order.", unitIds: [unitA], dueOn: "2026-10-24" });
    expect(res.status).toBe(200);
    id = res.body.id;
    const note = (await db.select().from(notifications).where(eq(notifications.userId, riyaId))).find((n) => n.title === "Upload: Semester 1-6 marksheets");
    expect(note!.body).toContain("by 2026-10-24");
    expect((await t.get(riya, "/student/documents")).body).toMatchObject({ todo: 1, requests: [expect.objectContaining({ id, file: null })] });
    expect((await t.get(kavya, "/student/documents")).body.requests).toEqual([]);
  });

  it("takes PDFs and photos up to 5 MB, checked by content", async () => {
    expect((await t.put(riya, `/student/documents/${id}`, { fileName: "marks.pdf", data: b64(Buffer.from("MZ\x90\x00 not a pdf")) })).status).toBe(400);
    expect((await t.put(riya, `/student/documents/${id}`, { fileName: "big.pdf", data: b64(Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(5 * 1024 * 1024)])) })).status).toBe(400);
    expect((await t.put(kavya, `/student/documents/${id}`, { fileName: "marks.pdf", data: b64(pdf) })).status).toBe(404);
    const res = await t.put(riya, `/student/documents/${id}`, { fileName: "../Riya marks.PDF", data: b64(pdf) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ todo: 0, requests: [expect.objectContaining({ file: expect.objectContaining({ fileName: "Riya marks.pdf", status: "pending", sizeBytes: pdf.length }) })] });
    const own = await raw(riya, `/student/documents/${id}/file`);
    expect(own.headers["content-type"]).toBe("application/pdf");
    expect(own.rawPayload.equals(pdf)).toBe(true);
  });

  it("lets staff open each file and verify it or send it back", async () => {
    const detail = (await t.get(tpo, `/console/documents/${id}`)).body;
    expect(detail.students[0]).toMatchObject({ id: riyaId, file: expect.objectContaining({ status: "pending" }) }); // to review comes first
    expect(detail.submitted).toBe(1);
    const file = await raw(tpo, `/console/documents/${id}/files/${riyaId}?download=1`);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-disposition"]).toContain('attachment; filename="Riya marks.pdf"');
    expect((await t.post(tpo, `/console/documents/${id}/review`, { userId: riyaId, verify: false })).status).toBe(400);
    await t.post(tpo, `/console/documents/${id}/review`, { userId: riyaId, verify: false, note: "Semester 4 is missing." });
    expect((await t.get(riya, "/student/documents")).body).toMatchObject({ todo: 1, requests: [expect.objectContaining({ file: expect.objectContaining({ status: "rejected", reviewNote: "Semester 4 is missing." }) })] });
    // Uploading again replaces the old file.
    const [before] = await db.select().from(documentSubmissions).where(eq(documentSubmissions.userId, riyaId));
    await t.put(riya, `/student/documents/${id}`, { fileName: "all six.pdf", data: b64(pdf) });
    expect(await getObject(before!.storageKey)).toBeNull();
    await t.post(tpo, `/console/documents/${id}/review`, { userId: riyaId, verify: true });
    expect((await t.put(riya, `/student/documents/${id}`, { fileName: "again.pdf", data: b64(pdf) })).status).toBe(409);
    expect((await t.get(tpo, "/console/documents")).body.requests[0]).toMatchObject({ submitted: 1, verified: 1, toReview: 0 });
  });

  it("reminds those who haven't uploaded, by hand and the day before", async () => {
    const audience = (await t.get(tpo, `/console/documents/${id}`)).body.audience;
    expect((await t.post(tpo, `/console/documents/${id}/remind`, {})).body.reminded).toBe(audience - 1);
    expect((await t.post(tpo, `/console/documents/${id}/remind`, {})).status).toBe(409);
    expect(await documentReminders(db, START)).toBe(0);
    expect(await documentReminders(db, new Date(START.getTime() + 24 * HOUR))).toBe(audience - 1);
    expect(await documentReminders(db, new Date(START.getTime() + 25 * HOUR))).toBe(0);
  });

  it("lists files in the data export, and stops uploads once closed", async () => {
    expect((await t.get(riya, "/privacy/export")).body.documents).toEqual([expect.objectContaining({ request: "Semester 1-6 marksheets", fileName: "all six.pdf", status: "verified" })]);
    expect((await t.post(faculty, `/console/documents/${id}/close`, {})).status).toBe(200);
    expect((await t.put(riya, `/student/documents/${id}`, { fileName: "x.pdf", data: b64(pdf) })).status).toBe(400);
  });
});
