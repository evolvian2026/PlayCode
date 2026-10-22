import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { aiUsage, tenants } from "../src/db/schema";
import { setAiProvider, type AiProvider } from "../src/lib/ai";
import { renderInvoicePdf, rupeesInWords } from "../src/services/billing";
import { setPaymentFetch } from "../src/services/payments";
import { createHmac } from "node:crypto";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let superAdmin: string;
let admin: string;

const fakeAi: AiProvider = {
  coachHint: async () => ({ value: "Look at the loop bound.", usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 } }),
  draftQuestions: async () => ({ value: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } }),
  reviewSnapshot: async () => ({ value: { faces: 1, phone: false, otherPerson: false, note: "" }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } }),
  draftCodingProblems: async () => ({ value: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } }),
  draftSqlProblems: async () => ({ value: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } }),
  interviewTurn: async () => { throw new Error("not used"); },
  interviewScorecard: async () => { throw new Error("not used"); },
};

function pdfText(pdf: Buffer): string {
  return [...pdf.toString("latin1").matchAll(/\[((?:<[0-9a-f]+>\s*-?[\d.]*\s*)+)\]\s*TJ/g)]
    .map((m) => [...m[1]!.matchAll(/<([0-9a-f]+)>/g)].map((h) => Buffer.from(h[1]!, "hex").toString("latin1")).join(""))
    .join("\n");
}

const tenantId = async (slug: string) => (await db.select().from(tenants).where(eq(tenants.slug, slug)))[0]!.id;

beforeAll(async () => {
  t = await setup();
  superAdmin = await t.login("superadmin@playcode.dev");
  admin = await t.login("admin@demo.edu");
  setAiProvider(fakeAi);
});

afterAll(async () => {
  setAiProvider(undefined);
  await t.app.close();
  await pool.end();
});

describe("plans", () => {
  it("limits features to what the plan includes", async () => {
    const res = await t.post(superAdmin, "/admin/tenants", { name: "Basic College", slug: "basic-college", plan: "starter", seats: 50, admin: { name: "Basic Admin", email: "admin@basic.edu", password: "basic-pass-1" } });
    expect(res.status).toBe(200);
    const basic = await t.login("admin@basic.edu", "basic-pass-1");
    const branding = await t.put(basic, "/console/branding", { appName: "Basic" });
    expect(branding.status).toBe(402);
    expect(branding.body.error).toMatchObject({ code: "plan_upgrade", message: "Your own branding is part of the Pro plan. Ask PlayCode to upgrade your plan." });
    expect((await t.get(basic, "/console/studio/questions")).status).toBe(402);
    expect((await t.put(basic, "/console/saml", {})).status).toBe(402);
    const usage = (await t.get(basic, "/console/billing")).body.usage;
    expect(usage).toMatchObject({ plan: "starter", planName: "Starter", seats: { licensed: 50, used: 0 } });
    expect(usage.features.find((f: { id: string }) => f.id === "ai_coach").included).toBe(false);

    // Upgrading unlocks it at once.
    await t.put(superAdmin, `/admin/tenants/${res.body.tenant.id}`, { plan: "pro" });
    expect((await t.put(basic, "/console/branding", { appName: "Basic" })).status).toBe(200);
    expect((await t.put(basic, "/console/saml", {})).status).toBe(402); // SAML needs Enterprise
  });

  it("stops partners giving colleges a higher plan than their own", async () => {
    const partnerId = await tenantId("skillbridge");
    await db.update(tenants).set({ plan: "pro" }).where(eq(tenants.id, partnerId));
    const partner = await t.login("partner@skillbridge.in");
    const res = await t.post(partner, "/admin/tenants", { name: "Too Fancy", slug: "too-fancy", plan: "enterprise", seats: 10, admin: { name: "A", email: "a@toofancy.edu", password: "fancy-pass-1" } });
    expect(res.status).toBe(403);
    await db.update(tenants).set({ plan: "enterprise" }).where(eq(tenants.id, partnerId));
  });

  it("pauses AI once a Pro plan's monthly allowance is used", async () => {
    // Sunrise is on Pro (2M tokens a month, no overage).
    const sunrise = await tenantId("sunrise");
    const student = await t.login("sunrise.student1@sunrise.edu");
    expect((await t.get(student, "/student/coach")).body.available).toBe(true);
    await db.insert(aiUsage).values({ tenantId: sunrise, userId: null, feature: "coach_hint", model: "claude-opus-5-5", inputTokens: 1_900_000, outputTokens: 150_000, createdAt: t.clock.now });
    expect((await t.get(student, "/student/coach")).body.available).toBe(false);
    const s = (await t.post(student, "/student/sessions", { kind: "skill", skillId: "loops.for" })).body;
    const res = await t.post(student, `/student/sessions/${s.id}/coach`, { questionId: s.question.id });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("this month's AI allowance");
  });
});

describe("billing", () => {
  it("validates the billing profile", async () => {
    const bad = await t.put(admin, "/console/billing/profile", { legalName: "Demo Institute of Technology", gstin: "NOT-A-GSTIN", address: "1 College Road, Bengaluru", stateCode: null, email: "accounts@demo.edu" });
    expect(bad.status).toBe(400);
    const ok = await t.put(admin, "/console/billing/profile", { legalName: "Demo Institute of Technology", gstin: "29abcde1234f1z5", address: "1 College Road, Bengaluru 560001", stateCode: "27", email: "Accounts@demo.edu" });
    expect(ok.body.profile).toMatchObject({ gstin: "29ABCDE1234F1Z5", stateCode: "29", email: "accounts@demo.edu" });
  });

  it("issues numbered GST invoices once per month", async () => {
    const demo = await tenantId("demo-tech");
    // 11.5M tokens in September: 1.5M over the Enterprise allowance.
    await db.insert(aiUsage).values({ tenantId: demo, userId: null, feature: "coach_hint", model: "claude-opus-5-5", inputTokens: 10_000_000, outputTokens: 1_500_000, createdAt: new Date("2026-09-15T10:00:00Z") });

    expect((await t.post(admin, "/admin/billing/run", { period: "2026-09" })).status).toBe(403);
    expect((await t.post(superAdmin, "/admin/billing/run", { period: "2026-10" })).status).toBe(400); // month not over
    const run = await t.post(superAdmin, "/admin/billing/run", { period: "2026-09" });
    const topLevel = (await db.select().from(tenants)).filter((x) => !x.parentId).length;
    expect(run.body.issued).toBe(topLevel);
    expect((await t.post(superAdmin, "/admin/billing/run", { period: "2026-09" })).body.issued).toBe(0);

    const mine = (await t.get(admin, "/console/billing")).body.invoices;
    expect(mine).toHaveLength(1);
    const inv = mine[0];
    expect(inv.number).toMatch(/^PC\/2026-27\/\d{4}$/);
    expect(inv.lines[0]).toMatchObject({ quantity: 500, unitPricePaise: 12_000, amountPaise: 6_000_000, sac: "998431" });
    expect(inv.lines[1]).toMatchObject({ quantity: 1.5, amountPaise: 60_000 });
    expect(inv.subtotalPaise).toBe(6_060_000);
    // Same state as the supplier (Karnataka): CGST + SGST.
    expect(inv).toMatchObject({ cgstPaise: 545_400, sgstPaise: 545_400, igstPaise: 0, totalPaise: 7_150_800 });

    // A customer without a billing profile is billed IGST.
    const all = (await t.get(superAdmin, "/admin/billing/invoices?period=2026-09")).body.invoices as { tenantName: string; igstPaise: number; number: string }[];
    expect(all.find((i) => i.tenantName === "Acme Technologies")!.igstPaise).toBeGreaterThan(0);
    expect(new Set(all.map((i) => i.number)).size).toBe(all.length);

    const pdf = await t.app.inject({ method: "GET", url: `/console/billing/invoices/${inv.id}/pdf`, headers: { authorization: `Bearer ${admin}` } });
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const other = await t.login("admin@sunrise.edu");
    expect((await t.get(other, `/console/billing/invoices/${inv.id}/pdf`)).status).toBe(404);

    const text = pdfText(await renderInvoicePdf({ ...inv, issuedAt: new Date(inv.issuedAt), dueAt: new Date(inv.dueAt) }, { compress: false }));
    for (const s of ["Tax invoice", inv.number, "29ABCDE1234F1Z5", "CGST 9%", "Rs 71,508.00", "Seventy One Thousand Five Hundred Eight Rupees Only"]) expect(text).toContain(s);

    const paid = await t.post(superAdmin, `/admin/billing/invoices/${inv.id}/status`, { status: "paid" });
    expect(paid.body.invoice.status).toBe("paid");
  });

  it("writes amounts in words the Indian way", () => {
    expect(rupeesInWords(12_345_678)).toBe("One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Seventy Eight Paise Only");
    expect(rupeesInWords(1_00_00_000_00)).toBe("One Crore Rupees Only");
  });
});

describe("online payments", () => {
  const links: { body: Record<string, unknown> }[] = [];
  const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");
  const webhook = (body: string, signature: string) =>
    t.app.inject({ method: "POST", url: "/webhooks/razorpay", payload: body, headers: { "content-type": "application/json", "x-razorpay-signature": signature } });

  beforeAll(() => {
    setPaymentFetch((async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      links.push({ body });
      return new Response(JSON.stringify({ id: `plink_${links.length}`, short_url: `https://rzp.io/i/test${links.length}` }), { status: 200 });
    }) as unknown as typeof fetch);
  });

  afterAll(() => {
    setPaymentFetch(undefined);
    for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) delete process.env[k];
  });

  it("pays an invoice through a Razorpay payment link", async () => {
    await t.post(superAdmin, "/admin/billing/run", { period: "2026-08" });
    const inv = (await t.get(admin, "/console/billing")).body.invoices.find((i: { period: string }) => i.period === "2026-08");
    expect((await t.get(admin, "/console/billing")).body.onlinePayments).toBe(false);
    expect((await t.post(admin, `/console/billing/invoices/${inv.id}/pay`)).status).toBe(400);

    Object.assign(process.env, { RAZORPAY_KEY_ID: "rzp_test_key", RAZORPAY_KEY_SECRET: "key-secret", RAZORPAY_WEBHOOK_SECRET: "hook-secret" });
    const pay = await t.post(admin, `/console/billing/invoices/${inv.id}/pay`);
    expect(pay.body.url).toBe("https://rzp.io/i/test1");
    expect(links[0]!.body).toMatchObject({ amount: inv.totalPaise, currency: "INR", reference_id: inv.number, callback_method: "get" });
    // The same link is reused.
    expect((await t.post(admin, `/console/billing/invoices/${inv.id}/pay`)).body.url).toBe("https://rzp.io/i/test1");
    expect(links).toHaveLength(1);

    const params = { razorpay_payment_id: "pay_1", razorpay_payment_link_id: "plink_1", razorpay_payment_link_reference_id: inv.number, razorpay_payment_link_status: "paid" };
    const forged = await t.post(admin, "/console/billing/payments/confirm", { ...params, razorpay_signature: "00" });
    expect(forged.status).toBe(400);
    const signature = sign("key-secret", `plink_1|${inv.number}|paid|pay_1`);
    const ok = await t.post(admin, "/console/billing/payments/confirm", { ...params, razorpay_signature: signature });
    expect(ok.body).toMatchObject({ paid: true, invoice: { status: "paid", paidVia: "razorpay", paymentRef: "pay_1" } });
    expect((await t.post(admin, `/console/billing/invoices/${inv.id}/pay`)).status).toBe(400); // already paid
  });

  it("marks invoices paid from Razorpay's signed webhook", async () => {
    const partner = await t.login("partner@skillbridge.in");
    const inv = (await t.get(partner, "/console/billing")).body.invoices.find((i: { period: string }) => i.period === "2026-08");
    await t.post(partner, `/console/billing/invoices/${inv.id}/pay`);
    const linkId = `plink_${links.length}`;
    const event = (amount: number) =>
      JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: linkId, status: "paid", amount_paid: amount } }, payment: { entity: { id: "pay_2" } } } });

    expect((await webhook(event(inv.totalPaise), "bad")).statusCode).toBe(401);
    // A short payment doesn't settle the invoice.
    await webhook(event(100), sign("hook-secret", event(100)));
    expect((await t.get(partner, "/console/billing")).body.invoices.find((i: { id: string }) => i.id === inv.id).status).toBe("issued");
    const res = await webhook(event(inv.totalPaise), sign("hook-secret", event(inv.totalPaise)));
    expect(res.json()).toEqual({ handled: true });
    // Redelivery is harmless.
    expect((await webhook(event(inv.totalPaise), sign("hook-secret", event(inv.totalPaise)))).statusCode).toBe(200);
    const after = (await t.get(partner, "/console/billing")).body.invoices.find((i: { id: string }) => i.id === inv.id);
    expect(after).toMatchObject({ status: "paid", paidVia: "razorpay", paymentRef: "pay_2" });
    const other = JSON.stringify({ event: "payment.captured", payload: {} });
    expect((await webhook(other, sign("hook-secret", other))).json()).toEqual({ handled: false });
  });
});

