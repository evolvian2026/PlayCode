import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, placementDrives, users } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

let t: TestApp;

beforeAll(async () => {
  t = await setup();
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

const latest = async (email: string) => {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const rows = await db.select().from(notifications).where(eq(notifications.userId, u!.id));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
};

describe("notifications in the student's language", () => {
  it("reach a Hindi student in Hindi and an English one in English, from the same reminder", async () => {
    const riya = await t.login("student@demo.edu");
    const rohan = await t.login("rohan.mehta3@demo.edu");
    await t.put(riya, "/student/settings", { locale: "hi" });
    const [drive] = await db.select().from(placementDrives).where(eq(placementDrives.company, "Accenture"));
    await t.post(riya, `/student/placements/${drive!.id}/register`, {});
    await t.post(rohan, `/student/placements/${drive!.id}/register`, {});
    await t.post(await t.login("tpo@demo.edu"), `/console/placements/${drive!.id}/prep/remind`, {});

    const english = await latest("rohan.mehta3@demo.edu");
    expect(english.title).toMatch(/^\d+ steps left before the Accenture drive$/);
    expect(english.body).toContain("A mock interview for this drive");

    const hindi = await latest("student@demo.edu");
    // The sentence and the step labels are Hindi; the company stays as it's written.
    expect(hindi.title).toContain("Accenture");
    expect(hindi.title).toContain("कदम");
    expect(hindi.body).toContain("इस ड्राइव के लिए एक मॉक इंटरव्यू");
    expect(hindi.body).not.toContain("mock interview");
  });

  it("write dates the student's way", async () => {
    // Riya reads Hindi (set above). A drive opening tells eligible students when to register by.
    const [riya] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    const res = await t.post(await t.login("tpo@demo.edu"), "/console/placements", {
      company: "Hexaware",
      companyType: "service",
      roleTitle: "Graduate Engineer",
      ctcRupees: 400000,
      driveDate: "2026-11-20",
      registerBy: "2026-11-10T12:00:00.000Z",
      criteria: { unitIds: [] },
      rounds: ["Online test", "Interview"],
    });
    expect(res.status).toBe(200);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, riya!.id), eq(notifications.dedupeKey, `placement-open:${res.body.drive.id}:${riya!.id}`)));
    expect(note!.title).toContain("Hexaware");
    expect(note!.title).not.toContain("is hiring");
    // "10 Nov", the Hindi way.
    expect(note!.body).toContain("10");
    expect(note!.body).not.toContain("Nov");
    expect(note!.body).not.toContain("Register by");
  });
});
