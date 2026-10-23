import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { consents, users } from "../src/db/schema";
import { renderResumePdf, resumeData } from "../src/services/resume";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;

function pdfText(pdf: Buffer): string {
  return [...pdf.toString("latin1").matchAll(/\[((?:<[0-9a-f]+>\s*-?[\d.]*\s*)+)\]\s*TJ/g)]
    .map((m) => [...m[1]!.matchAll(/<([0-9a-f]+)>/g)].map((h) => Buffer.from(h[1]!, "hex").toString("latin1")).join(""))
    .join("\n");
}

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("student resume", () => {
  it("builds the record from PlayCode activity", async () => {
    const { profile, resume } = (await t.get(riya, "/student/resume")).body;
    expect(profile).toEqual({ headline: "", about: "", links: {}, publicUrl: null });
    expect(resume).toMatchObject({ name: "Riya Kapoor", institution: "Demo Institute of Technology", academic: { cgpa: 8.1, graduationYear: 2027 }, mockInterview: { overall: 4, track: "service" } });
    expect(resume.readiness.map((r: { id: string }) => r.id)).toEqual(["service", "product"]);
    expect(resume.practice.questionsSolved).toBeGreaterThan(0);
    expect(resume.practice.activeDays90).toBeGreaterThan(0);
    for (const s of resume.skills) expect(s.mastery).toBeGreaterThanOrEqual(60);
  });

  it("takes the student's own headline and links", async () => {
    expect((await t.put(riya, "/student/resume", { links: { github: "http://github.com/riya" } })).status).toBe(400);
    const res = await t.put(riya, "/student/resume", { headline: "Final-year CSE student, Java and SQL", about: "I like building small tools.", links: { github: "https://github.com/riya", linkedin: "" } });
    expect(res.body.profile).toMatchObject({ headline: "Final-year CSE student, Java and SQL", links: { github: "https://github.com/riya" } });
    const pdf = await t.app.inject({ method: "GET", url: "/student/resume/pdf", headers: { authorization: `Bearer ${riya}` } });
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    const text = pdfText(await renderResumePdf(await resumeData(db, u!.id, t.clock.now), { compress: false }));
    for (const s of ["Riya Kapoor", "Final-year CSE student, Java and SQL", "Demo Institute of Technology", "CGPA 8.1", "Service companies readiness", "Mock technical interview"]) expect(text).toContain(s);
  });

  it("publishes a public profile without contact details, and can take it down", async () => {
    const on = (await t.post(riya, "/student/resume/public", { public: true })).body.profile;
    const code = on.publicUrl.split("/p/")[1];
    expect(on.publicUrl).toBe(`http://localhost:3000/p/${code}`);
    const pub = await t.app.inject({ method: "GET", url: `/public/profiles/${code}` });
    expect(pub.statusCode).toBe(200);
    const body = pub.json();
    expect(body).toMatchObject({ name: "Riya Kapoor", headline: "Final-year CSE student, Java and SQL", graduationYear: 2027 });
    for (const key of ["email", "rollNo", "academic"]) expect(body).not.toHaveProperty(key);
    expect(JSON.stringify(body)).not.toContain("student@demo.edu");

    await t.post(riya, "/student/resume/public", { public: false });
    expect((await t.app.inject({ method: "GET", url: `/public/profiles/${code}` })).statusCode).toBe(404);
    const again = (await t.post(riya, "/student/resume/public", { public: true })).body.profile.publicUrl;
    expect(again).not.toContain(code); // a new link each time
    const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    const ledger = (await db.select().from(consents).where(eq(consents.userId, u!.id))).filter((c) => c.purpose === "public_profile");
    expect(ledger.map((c) => c.granted)).toEqual([true, false, true]);
  });

  it("lets teachers download resumes of students in their scope", async () => {
    const faculty = await t.login("faculty@demo.edu");
    const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    const ok = await t.app.inject({ method: "GET", url: `/console/students/${u!.id}/resume.pdf`, headers: { authorization: `Bearer ${faculty}` } });
    expect(ok.headers["content-type"]).toBe("application/pdf");
    const [ece] = await db.select().from(users).where(eq(users.rollNo, "ECE27A005"));
    expect((await t.get(faculty, `/console/students/${ece!.id}/resume.pdf`)).status).toBe(404);
    expect((await t.get(riya, `/console/students/${u!.id}/resume.pdf`)).status).toBe(403);
  });
});
