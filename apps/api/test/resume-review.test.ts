import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { alumni, notifications, users } from "../src/db/schema";
import { setMailer, type Mail } from "../src/lib/mailer";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let riya: string;
let riyaId: string;
let reviewId: string;
const sent: Mail[] = [];

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
});

afterAll(async () => {
  setMailer(undefined);
  await t.app.close();
  await pool.end();
});

type Check = { section: string; level: string };

describe("resume checks and review", () => {
  it("checks the resume, and asks for the basics before a review", async () => {
    const before = (await t.get(riya, "/student/resume")).body;
    expect(before.checks.filter((c: Check) => c.level === "fix").map((c: Check) => c.section)).toEqual(["headline", "about", "projects"]);
    expect(before.score).toBe(100 - 3 * 15 - before.checks.filter((c: Check) => c.level === "tip").length * 5);
    const early = await t.post(riya, "/student/resume/review", { note: "" });
    expect(early.status).toBe(400);
    expect(early.body.error.message).toContain("headline, about you, projects");

    await t.put(riya, "/student/resume", { headline: "Final-year CSE student", about: "I like building small web apps.", links: { linkedin: "https://linkedin.com/in/riya" } });
    await t.post(riya, "/student/resume/entries", { kind: "project", title: "Canteen app", startMonth: "2026-01", description: "An app for ordering from the college canteen." });
    const after = (await t.get(riya, "/student/resume")).body;
    expect(after.checks.filter((c: Check) => c.level === "fix")).toEqual([]);
    expect(after.checks.map((c: Check) => c.section)).toEqual(expect.arrayContaining(["headline", "about", "projects"]));
  });

  it("puts the request in the reviewers' queue", async () => {
    const res = await t.post(riya, "/student/resume/review", { note: "Aiming for product companies." });
    expect(res.body.review).toMatchObject({ status: "waiting", note: "Aiming for product companies." });
    expect((await t.post(riya, "/student/resume/review", { note: "" })).status).toBe(409);
    const queue = (await t.get(faculty, "/console/resume-reviews")).body;
    expect(queue.waiting).toBe(1);
    expect(queue.reviews[0]).toMatchObject({ student: { name: "Riya Kapoor" }, daysWaiting: 0 });
    reviewId = queue.reviews[0].id;
    const detail = (await t.get(faculty, `/console/resume-reviews/${reviewId}`)).body;
    expect(detail.resume.headline).toBe("Final-year CSE student");
    expect(detail.checks.length).toBeGreaterThan(0);
    expect((await t.get(riya, "/console/resume-reviews")).status).toBe(403);
    // The head of Riya's department sees it too.
    expect((await t.get(await t.login("hod.cse@demo.edu"), "/console/resume-reviews")).body.waiting).toBe(1);
  });

  it("returns comments by section with a verdict, which the student works through", async () => {
    expect((await t.post(faculty, `/console/resume-reviews/${reviewId}`, { verdict: "changes", summary: "", comments: [] })).status).toBe(400);
    const res = await t.post(faculty, `/console/resume-reviews/${reviewId}`, {
      verdict: "changes",
      summary: "A good start. Two things before the Zoho drive.",
      comments: [
        { section: "projects", body: "Say how many students used the canteen app and what you built it with." },
        { section: "headline", body: "Name the kind of work you want: backend, web, data." },
        { section: "links", body: "  " },
      ],
    });
    expect(res.status).toBe(200);
    expect((await t.post(faculty, `/console/resume-reviews/${reviewId}`, { verdict: "ready" })).status).toBe(400);
    const mine = (await t.get(riya, "/student/resume/review")).body.review;
    expect(mine).toMatchObject({ status: "reviewed", verdict: "changes", verdictLabel: "Needs changes", reviewer: "Prof. Anil Kumar" });
    expect(mine.comments.map((c: { section: string }) => c.section)).toEqual(["projects", "headline"]);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, riyaId), like(notifications.title, "Your resume review: 2 things%")));
    expect(note!.body).toContain("A good start");
    const done = await t.put(riya, `/student/resume/review/comments/${mine.comments[0].id}`, { resolved: true });
    expect(done.body.review.comments[0].resolved).toBe(true);
    expect((await t.put(await t.login("aarav.sharma1@demo.edu"), `/student/resume/review/comments/${mine.comments[1].id}`, { resolved: true })).status).toBe(404);

    // Asking again starts a new review; the reviewer sees the earlier one.
    t.clock.now = new Date(t.clock.now.getTime() + 86_400_000);
    const again = await t.post(riya, "/student/resume/review", { note: "Fixed both." });
    const next = (await t.get(tpo, `/console/resume-reviews/${again.body.review.id}`)).body;
    expect(next.earlier).toHaveLength(1);
    expect((await t.post(riya, "/student/resume/review/withdraw")).body.review.status).toBe("reviewed");
  });
});

describe("alumni connect", () => {
  type Alum = { id: string; name: string; company: string; openToReferrals: boolean };
  let freshworks: Alum;
  let neha: Alum;

  it("shows students the alumni open to help, without their email", async () => {
    const res = (await t.get(riya, "/student/alumni")).body;
    // With last year's graduates who joined the list themselves (IIT Madras, PhonePe, Wipro).
    expect(res.alumni.map((a: Alum) => a.company)).toEqual(["Amazon", "Freshworks", "IIT Madras (M.Tech)", "Infosys", "PhonePe", "TCS", "Texas Instruments", "Wipro", "Zoho"]);
    expect(JSON.stringify(res.alumni)).not.toContain("@");
    freshworks = res.alumni.find((a: Alum) => a.company === "Freshworks");
    neha = res.alumni.find((a: Alum) => a.company === "TCS");
    expect(res.intros).toEqual([]);
  });

  it("takes a request for an introduction, within limits", async () => {
    const ask = (body: object) => t.post(riya, "/student/alumni/intros", { alumnusId: freshworks.id, purpose: "referral", message: "I'm Riya, a final-year CSE student. I'd value a referral for the SDE role at Freshworks.", ...body });
    expect((await ask({ message: "Hi, refer me?" })).status).toBe(400);
    expect((await ask({ alumnusId: neha.id, purpose: "advice" })).status).toBe(400); // Neha takes referral requests only
    const res = await ask({});
    expect(res.body.intros).toEqual([expect.objectContaining({ alumnus: "Lakshmi Narayan", status: "pending", purposeLabel: "A referral" })]);
    expect((await ask({ purpose: "advice" })).status).toBe(409);
  });

  it("lets the placement cell send it on with the resume, or decline with a reason", async () => {
    const queue = (await t.get(tpo, "/console/alumni/intros")).body.intros;
    expect(queue.map((i: { student: { name: string } }) => i.student.name)).toContain("Riya Kapoor");
    const mine = queue.find((i: { student: { name: string } }) => i.student.name === "Riya Kapoor");
    const other = queue.find((i: { student: { name: string } }) => i.student.name !== "Riya Kapoor");

    setMailer(null);
    expect((await t.post(tpo, `/console/alumni/intros/${mine.id}`, { send: true })).status).toBe(400);
    setMailer({ send: async (m) => void sent.push(m) });
    expect((await t.post(tpo, `/console/alumni/intros/${mine.id}`, { send: true })).status).toBe(200);
    expect(sent[0]).toMatchObject({ to: "lakshmi.n@example.com", subject: "Riya Kapoor from Demo Institute of Technology would like a referral" });
    expect(sent[0]!.text).toContain("reply to them at student@demo.edu");
    expect(sent[0]!.text).toContain("Riya Kapoor, a Computer Science student at Demo Institute of Technology graduating in 2027,");
    expect(sent[0]!.attachments![0]!.content.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await t.get(riya, "/student/alumni")).body.intros[0].status).toBe("sent");
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, riyaId), like(notifications.title, "Your introduction to Lakshmi Narayan has been sent")));
    expect(note).toBeDefined();

    expect((await t.post(tpo, `/console/alumni/intros/${other.id}`, { send: false })).status).toBe(400);
    await t.post(tpo, `/console/alumni/intros/${other.id}`, { send: false, note: "Lakshmi is travelling this month; try again in December." });
    expect((await t.get(tpo, "/console/alumni/intros?status=declined")).body.intros[0].declineNote).toContain("travelling");
    expect((await t.get(faculty, "/console/alumni")).status).toBe(403);
  });

  it("keeps the directory", async () => {
    const add = (body: object) => t.post(tpo, "/console/alumni", { name: "Sana Iqbal", email: "Sana.Iqbal@example.com", graduationYear: 2024, company: "Razorpay", role: "SDE I", openToReferrals: true, ...body });
    expect((await add({ email: "not-an-email" })).status).toBe(400);
    const created = (await add({})).body;
    expect(created.email).toBe("sana.iqbal@example.com");
    expect((await add({ email: "sana.iqbal@example.com" })).status).toBe(409);
    await t.put(tpo, `/console/alumni/${created.id}`, { name: "Sana Iqbal", email: "sana.iqbal@example.com", graduationYear: 2024, company: "Razorpay", role: "SDE I", active: false });
    expect((await t.get(riya, "/student/alumni")).body.alumni.some((a: Alum) => a.company === "Razorpay")).toBe(false);
    await t.delete(tpo, `/console/alumni/${freshworks.id}`);
    expect(await db.select().from(alumni).where(eq(alumni.id, freshworks.id))).toEqual([]);
    expect((await t.get(riya, "/student/alumni")).body.intros).toEqual([]);
  });
});
