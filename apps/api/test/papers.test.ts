import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeAnswer } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { questions } from "../src/db/schema";
import { keyAnswer, paperWording, pdfSafe, printedSet } from "../src/services/papers";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let faculty: string;
let paperId: string;

const pdf = async (token: string, url: string) => {
  const res = await t.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  return { status: res.statusCode, type: res.headers["content-type"], body: res.rawPayload };
};

beforeAll(async () => {
  t = await setup();
  faculty = await t.login("faculty@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("question papers", () => {
  it("offers skills with printable questions, leaving out coding problems", async () => {
    const { skills } = (await t.get(faculty, "/console/papers/skills")).body;
    expect(skills.find((s: { id: string }) => s.id === "strings.basics")).toMatchObject({ available: expect.any(Number) });
    expect(skills.find((s: { id: string }) => s.id === "coding.dsa")).toBeUndefined();
    expect((await t.get(await t.login("student@demo.edu"), "/console/papers/skills")).status).toBe(403);
  });

  it("builds a paper from the chosen skills", async () => {
    const base = { title: "CSE 2027 unit test 2", durationMinutes: 40, marksPerQuestion: 2, sets: 2 };
    expect((await t.post(faculty, "/console/papers", { ...base, picks: [{ skillId: "strings.basics", count: 61 }] })).status).toBe(400);
    expect((await t.post(faculty, "/console/papers", { ...base, picks: [{ skillId: "strings.basics", count: 50 }] })).body.error.message).toContain("Only");
    const res = await t.post(faculty, "/console/papers", { ...base, picks: [{ skillId: "strings.basics", count: 3 }, { skillId: "dbms.keys", count: 2 }] });
    expect(res.status).toBe(200);
    paperId = res.body.id;
    expect(res.body).toMatchObject({ title: "CSE 2027 unit test 2", questions: 5, marks: 10, sets: 2 });
    expect(res.body.items.map((i: { skillId: string }) => i.skillId)).toEqual(["strings.basics", "strings.basics", "strings.basics", "dbms.keys", "dbms.keys"]);
    expect((await t.get(faculty, "/console/papers")).body.papers[0]).toMatchObject({ id: paperId, by: "Prof. Anil Kumar" });
  });

  it("prints set B in another order, with a key that matches it", async () => {
    const { items } = (await t.get(faculty, `/console/papers/${paperId}`)).body;
    const qs = await db.select().from(questions).where(inArray(questions.id, items.map((i: { id: string }) => i.id)));
    const ordered = items.map((i: { id: string }) => qs.find((q) => q.id === i.id)!);
    const a = printedSet(paperId, ordered, "A");
    const b = printedSet(paperId, ordered, "B");
    expect(a.map((p) => p.q.id)).toEqual(items.map((i: { id: string }) => i.id));
    expect(new Set(b.map((p) => p.q.id))).toEqual(new Set(a.map((p) => p.q.id)));
    expect(printedSet(paperId, ordered, "B").map((p) => p.q.id)).toEqual(b.map((p) => p.q.id)); // stable
    for (const p of b) {
      if (p.q.answer.kind !== "option") continue;
      // The key's letter points at the right option as printed in this set.
      const letter = keyAnswer(p).slice(1, 2);
      expect(p.options["abcdefgh".indexOf(letter)]!.text).toBe(describeAnswer(p.q));
    }
  });

  it("downloads the paper and the key as PDFs", async () => {
    for (const url of [`/console/papers/${paperId}/pdf`, `/console/papers/${paperId}/pdf?set=B`, `/console/papers/${paperId}/pdf?set=B&kind=key`]) {
      const res = await pdf(faculty, url);
      expect(res.status).toBe(200);
      expect(res.type).toBe("application/pdf");
      expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    }
    expect((await pdf(await t.login("admin@sunrise.edu"), `/console/papers/${paperId}/pdf`)).status).toBe(404);
  });

  it("keeps text printable in the PDF fonts", () => {
    expect(pdfSafe("Price ₹500 → profit 2ⁿ “quoted” ≤ 3 · fine")).toBe('Price Rs 500 -> profit 2^n "quoted" <= 3 · fine');
    expect(pdfSafe("नमस्ते")).toBe("??????");
    expect(paperWording("This should print the average. Tap the line with the bug. Type the exact output.")).toBe("This should print the average. Find the line with the bug. Write the exact output.");
  });

  it("lets staff delete a paper", async () => {
    expect((await t.delete(faculty, `/console/papers/${paperId}`)).body).toEqual({ ok: true });
    expect((await t.get(faculty, `/console/papers/${paperId}`)).status).toBe(404);
  });
});
