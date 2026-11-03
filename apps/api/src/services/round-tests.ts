import { and, eq, inArray } from "drizzle-orm";
import { cutoffResult, ROUND_TEST_REVIEW_RISK } from "@playcode/core";
import type { Db } from "../db/client";
import { assessmentAttempts, assessments, driveRoundTests, placementApplications, placementDrives, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { updateApplications } from "./placements";
import { descendants, studentUnitIdsWithAncestors, tenantUnits } from "./scope";

// A drive's online test run on PlayCode. The placement cell links one of its
// tests to a round and sets the cut-off; once the test closes, students who
// scored at or above it clear the round and the rest are not selected, in one
// step. Attempts proctoring flagged as risky are held for a person to look at,
// and students who didn't take the test are left for the placement cell.

type Auth = { tenantId: string; userId: string };
export type RoundTestResult = "pass" | "fail" | "review" | "not_taken" | "in_progress" | "not_invited";

async function loadDrive(db: Db, tenantId: string, id: string) {
  const [d] = await db.select().from(placementDrives).where(and(eq(placementDrives.id, id), eq(placementDrives.tenantId, tenantId)));
  if (!d) throw notFound("Placement drive");
  return d;
}

export async function setRoundTest(db: Db, auth: Auth, driveId: string, input: { round: number; assessmentId: string; cutoffPct: number }, now: Date) {
  const drive = await loadDrive(db, auth.tenantId, driveId);
  if (!drive.rounds[input.round]) throw badRequest("That round isn't part of this drive");
  const [a] = await db.select().from(assessments).where(and(eq(assessments.id, input.assessmentId), eq(assessments.tenantId, auth.tenantId)));
  if (!a) throw notFound("Test");
  const values = { assessmentId: a.id, cutoffPct: input.cutoffPct, appliedAt: null, appliedBy: null };
  await db
    .insert(driveRoundTests)
    .values({ driveId: drive.id, round: input.round, tenantId: auth.tenantId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: [driveRoundTests.driveId, driveRoundTests.round], set: values });
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.round_test", target: drive.id, data: { round: input.round, assessmentId: a.id, cutoffPct: input.cutoffPct } });
  return roundTests(db, auth.tenantId, drive.id, now);
}

export async function removeRoundTest(db: Db, auth: Auth, driveId: string, round: number, now: Date) {
  const drive = await loadDrive(db, auth.tenantId, driveId);
  await db.delete(driveRoundTests).where(and(eq(driveRoundTests.driveId, drive.id), eq(driveRoundTests.round, round)));
  return roundTests(db, auth.tenantId, drive.id, now);
}

/** Each linked round with its test, and where each student waiting for that round stands. */
export async function roundTests(db: Db, tenantId: string, driveId: string, now: Date) {
  const drive = await loadDrive(db, tenantId, driveId);
  const links = await db.select({ link: driveRoundTests, test: assessments }).from(driveRoundTests).innerJoin(assessments, eq(assessments.id, driveRoundTests.assessmentId)).where(eq(driveRoundTests.driveId, drive.id));
  const out = [];
  for (const { link, test } of links) {
    const apps = await db
      .select({ userId: placementApplications.userId, name: users.name, rollNo: users.rollNo })
      .from(placementApplications)
      .innerJoin(users, eq(users.id, placementApplications.userId))
      .where(and(eq(placementApplications.driveId, drive.id), inArray(placementApplications.status, ["registered", "shortlisted"]), eq(placementApplications.roundsCleared, link.round)));
    const attempts = apps.length ? await db.select().from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, test.id), inArray(assessmentAttempts.userId, apps.map((a) => a.userId)))) : [];
    const testUnits = new Set(descendants(await tenantUnits(db, tenantId), test.orgUnitIds));
    const students: { userId: string; name: string; rollNo: string | null; result: RoundTestResult; pct: number | null; riskScore: number | null }[] = [];
    for (const a of apps) {
      const at = attempts.find((x) => x.userId === a.userId);
      let result: RoundTestResult;
      let pct: number | null = null;
      if (at && at.status !== "in_progress" && at.score !== null && at.maxScore !== null) {
        const r = cutoffResult(at.score, at.maxScore, link.cutoffPct);
        pct = r.pct;
        result = at.riskScore >= ROUND_TEST_REVIEW_RISK ? "review" : r.passed ? "pass" : "fail";
      } else if (at) result = "in_progress";
      else {
        const mine = await studentUnitIdsWithAncestors(db, tenantId, a.userId);
        result = mine.some((u) => testUnits.has(u)) ? "not_taken" : "not_invited";
      }
      students.push({ ...a, result, pct, riskScore: at?.riskScore ?? null });
    }
    students.sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1) || (x.rollNo ?? x.name).localeCompare(y.rollNo ?? y.name, "en", { numeric: true }));
    out.push({
      round: link.round,
      roundName: drive.rounds[link.round] ?? "",
      cutoffPct: link.cutoffPct,
      appliedAt: link.appliedAt,
      test: { id: test.id, title: test.title, openAt: test.openAt, closeAt: test.closeAt, closed: test.closeAt <= now },
      counts: Object.fromEntries((["pass", "fail", "review", "not_taken", "in_progress", "not_invited"] as RoundTestResult[]).map((k) => [k, students.filter((s) => s.result === k).length])) as Record<RoundTestResult, number>,
      students,
    });
  }
  return { rounds: out.sort((a, b) => a.round - b.round) };
}

/** After the test closes: those at or above the cut-off clear the round, those below are not selected. */
export async function applyRoundTest(db: Db, auth: Auth, driveId: string, round: number, now: Date) {
  const view = (await roundTests(db, auth.tenantId, driveId, now)).rounds.find((r) => r.round === round);
  if (!view) throw notFound("Test round");
  if (!view.test.closed) throw badRequest("Wait until the test closes, so everyone has had their chance");
  const pass = view.students.filter((s) => s.result === "pass").map((s) => s.userId);
  const fail = view.students.filter((s) => s.result === "fail").map((s) => s.userId);
  if (pass.length) await updateApplications(db, { tenantId: auth.tenantId, actorId: auth.userId, driveId, userIds: pass, action: "advance", now });
  if (fail.length) await updateApplications(db, { tenantId: auth.tenantId, actorId: auth.userId, driveId, userIds: fail, action: "reject", now });
  await db.update(driveRoundTests).set({ appliedAt: now, appliedBy: auth.userId }).where(and(eq(driveRoundTests.driveId, driveId), eq(driveRoundTests.round, round)));
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.round_test_applied", target: driveId, data: { round, cleared: pass.length, notSelected: fail.length } });
  return { cleared: pass.length, notSelected: fail.length, ...(await roundTests(db, auth.tenantId, driveId, now)) };
}
