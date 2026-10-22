import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { setMailer, type Mail } from "../src/lib/mailer";
import { renderReportPdf, reportData, sendDueReports } from "../src/services/reports";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
const sent: Mail[] = [];

/** The text drawn in an uncompressed PDF: each TJ array's hex strings, decoded and joined. */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  return [...raw.matchAll(/\[((?:<[0-9a-f]+>\s*-?[\d.]*\s*)+)\]\s*TJ/g)]
    .map((m) => [...m[1]!.matchAll(/<([0-9a-f]+)>/g)].map((h) => Buffer.from(h[1]!, "hex").toString("latin1")).join(""))
    .join("\n");
}

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  setMailer({ send: async (m) => void sent.push(m) });
});

afterAll(async () => {
  setMailer(undefined);
  await t.app.close();
  await pool.end();
});

describe("weekly reports", () => {
  it("downloads as a PDF for the user's scope", async () => {
    const res = await t.app.inject({ method: "GET", url: "/console/reports/weekly.pdf", headers: { authorization: `Bearer ${tpo}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

    const me = (await t.get(tpo, "/me")).body;
    const data = await reportData(db, { auth: { userId: me.user.id, tenantId: me.tenant.id, roles: me.user.roles }, now: t.clock.now });
    expect(data.engagement.totalStudents).toBe(31);
    expect(data.paths.map((p) => p.title)).toContain("Service company placement track");
    const text = pdfText(await renderReportPdf(data, { compress: false }));
    for (const s of ["PlayCode weekly report", "Demo Institute of Technology", "Placement readiness", "Weakest skills", "Service company placement track", "Students who need attention"]) {
      expect(text).toContain(s);
    }
  });

  it("keeps staff to their own batches", async () => {
    const units = Object.fromEntries((await t.get(tpo, "/console/org-units")).body.units.map((u: { name: string; id: string }) => [u.name, u.id]));
    const faculty = await t.login("faculty@demo.edu");
    expect((await t.app.inject({ method: "GET", url: `/console/reports/weekly.pdf?unitId=${units["ECE 2027 - A"]}`, headers: { authorization: `Bearer ${faculty}` } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "GET", url: `/console/reports/weekly.pdf?unitId=${units["CSE 2027 - A"]}`, headers: { authorization: `Bearer ${faculty}` } })).statusCode).toBe(200);
    const student = await t.login("student@demo.edu");
    expect((await t.get(student, "/console/reports/subscription")).status).toBe(403);
  });

  it("emails subscribers on their day and hour, once a week", async () => {
    // START is Thursday 12:00 in India (weekday 4).
    const sub = await t.put(tpo, "/console/reports/subscription", { enabled: true, unitId: null, weekday: 4, hour: 9 });
    expect(sub.status).toBe(200);
    expect((await t.get(tpo, "/console/reports/subscription")).body).toMatchObject({ emailConfigured: true, subscription: { weekday: 4, hour: 9, enabled: true } });

    expect((await sendDueReports(db, new Date(START.getTime() - 4 * 3600_000))).sent).toBe(0); // 08:00 local: too early
    expect((await sendDueReports(db, START)).sent).toBe(1);
    expect(sent[0]!.to).toBe("tpo@demo.edu");
    expect(sent[0]!.subject).toContain("weekly report");
    expect(sent[0]!.attachments![0]!.contentType).toBe("application/pdf");
    expect(sent[0]!.attachments![0]!.content.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await sendDueReports(db, new Date(START.getTime() + 3600_000))).sent).toBe(0); // already sent this week
    expect((await sendDueReports(db, new Date(START.getTime() + 7 * 86_400_000))).sent).toBe(1); // next Thursday

    setMailer(null);
    expect(await sendDueReports(db, new Date(START.getTime() + 14 * 86_400_000))).toMatchObject({ sent: 0, skipped: expect.stringContaining("SMTP_URL") });
    setMailer({ send: async (m) => void sent.push(m) });
  });
});
