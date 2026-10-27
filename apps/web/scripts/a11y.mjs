// Accessibility check: runs axe-core (WCAG 2.1 A and AA rules) on the main
// student and console screens of a running app, signed in as the demo users.
// Usage: start the API and web app with the demo seed, then
//   PW=$(npm root -g)/playwright node scripts/a11y.mjs [http://localhost:3000]
// Exits non-zero if any serious or critical violation is found.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? "playwright");
const axePath = require.resolve("axe-core/axe.min.js");
const base = process.argv[2] ?? "http://localhost:3000";

const PAGES = [
  { as: null, path: "/login", mobile: true },
  { as: "student@demo.edu", path: "/play", mobile: true },
  { as: "student@demo.edu", path: "/play/learn", mobile: true },
  { as: "student@demo.edu", path: "/play/me", mobile: true },
  { as: "student@demo.edu", path: "/play/placements", mobile: true },
  { as: "student@demo.edu", path: "/play/resume", mobile: true },
  { as: "student@demo.edu", path: "/play/league", mobile: true },
  { as: "student@demo.edu", path: "/play/inbox", mobile: true },
  { as: "tpo@demo.edu", path: "/console", mobile: false },
  { as: "tpo@demo.edu", path: "/console/students", mobile: false },
  { as: "tpo@demo.edu", path: "/console/assignments", mobile: false },
  { as: "tpo@demo.edu", path: "/console/placements", mobile: false },
  { as: "tpo@demo.edu", path: "/console/placements/outcomes", mobile: false },
  { as: "tpo@demo.edu", path: "/console/reports", mobile: false },
  { as: "admin@demo.edu", path: "/console/billing", mobile: false },
  { as: "admin@demo.edu", path: "/console/settings", mobile: false },
  { as: "student@demo.edu", path: "/play/missions", mobile: true },
  { as: "student@demo.edu", path: "/play/paths", mobile: true },
  { as: "student@demo.edu", path: "/play/interview", mobile: true },
  { as: "student@demo.edu", path: "/play/duels", mobile: true },
  { as: "student@demo.edu", path: "/play/talent", mobile: true },
  { as: "recruiter@acme.dev", path: "/console/talent", mobile: false },
  { as: "student@demo.edu", path: "/play/contests", mobile: true },
  { as: "student@demo.edu", path: "/play/plan", mobile: true },
  { as: "tpo@demo.edu", path: "/console/contests", mobile: false },
  { as: "student@demo.edu", path: "/play/live", mobile: true },
  { as: "faculty@demo.edu", path: "/console/live", mobile: false },
  { as: "hod.cse@demo.edu", path: "/console/studio", mobile: false },
  { as: "content@playcode.dev", path: "/console/studio/review", mobile: false },
  { as: "faculty@demo.edu", path: "/console/interviews", mobile: false },
  { as: "student@demo.edu", path: "/play/mocks", mobile: true },
  { as: "student@demo.edu", path: "/play/squad", mobile: true },
  { as: "student@demo.edu", path: "/offline", mobile: true },
  { as: "student@demo.edu", path: "/play/panel", mobile: true },
  { as: "student@demo.edu", path: "/play/doubts", mobile: true },
  { as: "faculty@demo.edu", path: "/console/doubts", mobile: false },
  { as: "tpo@demo.edu", path: "/console/interview-slots", mobile: false },
  { as: "student@demo.edu", path: "/play/gd", mobile: true },
  { as: "student@demo.edu", path: "/play/writing", mobile: true },
  { as: "student@demo.edu", path: "/play/writing?task=email-contest", mobile: true },
  { as: "faculty@demo.edu", path: "/console/papers", mobile: false },
  { as: "faculty@demo.edu", path: "/console/papers?new=1", mobile: false },
  { as: "faculty@demo.edu", path: "/console/gd", mobile: false },
  { as: "faculty@demo.edu", path: "/console/writing", mobile: false },
  { as: "student@demo.edu", path: "/play/training", mobile: true },
  { as: "student@demo.edu", path: "/play/calendar", mobile: true },
  { as: "tpo@demo.edu", path: "/console/activity", mobile: false },
  { as: "student@demo.edu", path: "/play/experiences", mobile: true },
  { as: "student@demo.edu", path: "/play/experiences?write=1", mobile: true },
  { as: "student@demo.edu", path: "/play/mentor", mobile: true },
  { as: "tpo@demo.edu", path: "/console/experiences", mobile: false },
  { as: "tpo@demo.edu", path: "/console/mentoring", mobile: false },
  { as: "faculty@demo.edu", path: "/console/mentees", mobile: false },
  { as: "student@demo.edu", path: "/play/class-tests", mobile: true },
  { as: "tpo@demo.edu", path: "/console/training", mobile: false },
  { as: "tpo@demo.edu", path: "/console/training?view=new", mobile: false },
  { as: "tpo@demo.edu", path: "/console/training?view=attendance", mobile: false },
  { as: "faculty@demo.edu", path: "/console/assignments?new=1&remedial=aptitude.time", mobile: false },
  { as: "superadmin@playcode.dev", path: "/console/health", mobile: false },
  { as: "superadmin@playcode.dev", path: "/console/billing", mobile: false },
];

const browser = await chromium.launch();
const sessions = new Map();
async function contextFor(as, mobile) {
  const key = `${as}:${mobile}`;
  if (sessions.has(key)) return sessions.get(key);
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 } });
  if (as) {
    const p = await ctx.newPage();
    await p.goto(`${base}/login`);
    await p.locator("#email").fill(as);
    await p.locator("#password").fill("playcode123");
    await p.locator("form button.primary").click();
    await p.waitForURL(/(play|console)/);
    await p.close();
  }
  sessions.set(key, ctx);
  return ctx;
}

let serious = 0;
for (const pg of PAGES) {
  const ctx = await contextFor(pg.as, pg.mobile);
  const page = await ctx.newPage();
  await page.goto(`${base}${pg.path}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations);
  const bad = result.filter((v) => v.impact === "serious" || v.impact === "critical");
  serious += bad.length;
  console.log(`${result.length === 0 ? "ok  " : bad.length ? "FAIL" : "warn"} ${pg.path}${pg.as ? ` (${pg.as})` : ""}`);
  for (const v of result) {
    console.log(`     [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})`);
    for (const n of v.nodes.slice(0, 3)) console.log(`        ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
  }
  await page.close();
}
await browser.close();
console.log(serious ? `\n${serious} serious or critical violations` : "\nNo serious or critical violations");
process.exit(serious ? 1 : 0);
