import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, users } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let aarav: string;
let zoho: string;
let upcoming: string;
let experienceId: string;

const write = {
  result: "not_selected",
  difficulty: 4,
  rounds: [
    { name: "Written test", description: "20 aptitude questions and 10 C output questions in an hour; pointers and recursion came up a lot." },
    { name: "Programming round", description: "Three problems in 90 minutes: string compression, matrix spiral and a simple DP on stairs." },
  ],
  tips: "Practise output prediction in C. They watch how you test your own code.",
  anonymous: true,
};

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  aarav = await t.login("aarav.sharma1@demo.edu");
  const mine = (await t.get(riya, "/student/experiences/mine")).body.drives as { driveId: string; company: string }[];
  zoho = mine.find((d) => d.company === "Zoho")!.driveId;
  upcoming = ((await t.get(riya, "/student/placements")).body.drives as { id: string; open: boolean }[]).find((d) => d.open)!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("interview experiences", () => {
  it("offers only drives the student took part in that have happened", async () => {
    const mine = (await t.get(riya, "/student/experiences/mine")).body.drives;
    expect(mine.find((d: { driveId: string }) => d.driveId === zoho)).toMatchObject({ rounds: ["Written test", "Programming round", "Technical interview", "HR interview"], experience: null });
    expect(mine.some((d: { driveId: string }) => d.driveId === upcoming)).toBe(false);
  });

  it("checks the write-up before it goes to the placement cell", async () => {
    expect((await t.put(riya, `/student/placements/${zoho}/experience`, { ...write, rounds: [{ name: "Group dance", description: "Not a round" }] })).status).toBe(400);
    expect((await t.put(riya, `/student/placements/${zoho}/experience`, { ...write, rounds: [{ name: "Written test", description: "   " }] })).status).toBe(400);
    expect((await t.put(riya, `/student/placements/${upcoming}/experience`, write)).status).toBe(403); // not registered for it
    const res = await t.put(riya, `/student/placements/${zoho}/experience`, write);
    expect(res.status).toBe(200);
    expect(res.body.drives.find((d: { driveId: string }) => d.driveId === zoho).experience).toMatchObject({ status: "pending", anonymous: true });
    // Nothing is public until it's approved.
    expect((await t.get(aarav, "/student/experiences")).body.companies).toEqual([]);
  });

  it("lets the placement cell send it back with a note, or publish it", async () => {
    const queue = (await t.get(tpo, "/console/experiences")).body.experiences;
    expect(queue).toHaveLength(1);
    experienceId = queue[0].id;
    expect(queue[0]).toMatchObject({ company: "Zoho", author: "Riya Kapoor", anonymous: true, status: "pending" }); // staff see who wrote it
    expect((await t.get(tpo, "/console/experiences/count")).body).toEqual({ pending: 1 });
    expect((await t.post(tpo, `/console/experiences/${experienceId}/review`, { publish: false })).status).toBe(400);
    await t.post(tpo, `/console/experiences/${experienceId}/review`, { publish: false, note: "Please leave out the interviewer's name." });
    const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    const notes = (await db.select().from(notifications).where(eq(notifications.userId, u!.id))).filter((n) => n.title.includes("interview experience"));
    expect(notes.map((n) => n.title)).toEqual(["Please revise your Zoho interview experience"]);
    expect((await t.get(riya, "/student/experiences/mine")).body.drives.find((d: { driveId: string }) => d.driveId === zoho).experience).toMatchObject({ status: "rejected", reviewNote: "Please leave out the interviewer's name." });

    await t.put(riya, `/student/placements/${zoho}/experience`, write); // revised
    await t.post(tpo, `/console/experiences/${experienceId}/review`, { publish: true });
    expect((await db.select().from(notifications).where(eq(notifications.userId, u!.id))).map((n) => n.title)).toContain("Your Zoho interview experience is live");
    expect((await t.get(riya, "/console/experiences")).status).toBe(403);
  });

  it("shows published experiences by company, keeping anonymous authors anonymous", async () => {
    const read = (await t.get(aarav, "/student/experiences?company=zoho")).body.companies;
    expect(read).toEqual([expect.objectContaining({ company: "Zoho", count: 1, averageDifficulty: 4, selected: 0 })]);
    expect(read[0].experiences[0]).toMatchObject({ author: null, roleTitle: "Member Technical Staff", tips: expect.stringContaining("output prediction") });
    expect(JSON.stringify(read)).not.toContain("Riya");
    expect((await t.get(aarav, "/student/experiences/counts")).body).toEqual({ counts: { zoho: 1 } });
    expect((await t.get(await t.login("admin@sunrise.edu"), "/student/experiences")).status).toBe(403); // staff of another college
  });
});
