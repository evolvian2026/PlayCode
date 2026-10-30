import { and, eq, sql } from "drizzle-orm";
import {
  initialQuestionRating,
  isoWeekKey,
  localDate,
  seededRandom,
  type Role,
} from "@playcode/core";
import { ALL_QUESTIONS as QUESTIONS, PACKS, SKILLS } from "../content";
import { correctResponse, wrongResponse } from "../content/responses";
import { hashPassword } from "../lib/auth";
import { saveAnswer, startAttempt, submitOwn } from "../services/assessments";
import { applyToDrive, createDrive } from "../services/drives";
import { closeLeagueWeek } from "../services/leagues";
import { answerQuestion, startSession, type StartInput } from "../services/practice";
import { createPath } from "../services/paths";
import { requestErasure } from "../services/privacy";
import { snapshotBenchmarks } from "../services/benchmarks";
import { createContest } from "../services/contests";
import { sendInvite, setDiscoverable, setInstitutionPool } from "../services/talent";
import { db, pool, type Db } from "./client";
import { runMigrations } from "./migrate";
import { seedAlumni, seedInterview, seedPeer, seedJoiningAndOpenings, seedPlacements, seedRecruiters } from "./seed-placements";
import { assessments, assignments, competitions, contestSubmissions, memberships, orgUnits, packs, questionReports, questions, responses, skills, tenants, users } from "./schema";

export const DEMO_PASSWORD = "playcode123";

/** Upsert the global syllabus, question bank and missions. Safe to re-run. */
export async function seedContent(database: Db = db): Promise<void> {
  for (const [position, s] of SKILLS.entries()) {
    await database
      .insert(skills)
      .values({ ...s, position })
      .onConflictDoUpdate({ target: skills.id, set: { topic: s.topic, topicName: s.topicName, name: s.name, position } });
  }
  for (const q of QUESTIONS) {
    const values = {
      id: q.id,
      type: q.type,
      skillId: q.skillId,
      language: q.body.language,
      difficulty: q.difficulty,
      body: q.body,
      answer: q.answer,
      explanation: q.explanation,
      hints: q.hints,
      tags: q.tags ?? [],
      solutions: q.solutions ?? null,
    };
    await database
      .insert(questions)
      .values({ ...values, rating: initialQuestionRating(q.difficulty) })
      // Content edits bump the version; calibration data (rating, attempts) is kept.
      .onConflictDoUpdate({ target: questions.id, set: { ...values, version: sql`${questions.version} + 1` } });
  }
  for (const [position, p] of PACKS.entries()) {
    await database
      .insert(packs)
      .values({ ...p, position })
      .onConflictDoUpdate({ target: packs.id, set: { ...p, position } });
  }
}

const FIRST = ["Aarav", "Ananya", "Rohan", "Priya", "Vikram", "Sneha", "Arjun", "Kavya", "Rahul", "Isha", "Karthik", "Meera", "Aditya", "Divya", "Nikhil", "Pooja", "Siddharth", "Riya", "Varun", "Neha", "Harsh", "Tanvi", "Manish", "Shreya", "Yash", "Anjali", "Pranav", "Nandini", "Kunal", "Aisha"];
const LAST = ["Sharma", "Iyer", "Patel", "Reddy", "Singh", "Nair", "Gupta", "Menon", "Verma", "Das", "Joshi", "Rao", "Kulkarni", "Banerjee", "Mehta"];

async function createUser(
  tenantId: string | null,
  name: string,
  email: string,
  passwordHash: string,
  roles: { role: Role; orgUnitId: string | null }[],
  rollNo: string | null = null,
) {
  const [user] = await db.insert(users).values({ tenantId, name, email, passwordHash, rollNo }).returning();
  for (const r of roles) await db.insert(memberships).values({ userId: user!.id, tenantId, orgUnitId: r.orgUnitId, role: r.role });
  return user!;
}

interface SimStudent {
  id: string;
  rand: () => number;
  skill: number; // 0-1, chance of a correct answer on easy questions
  activity: number; // 0-1, chance of practising on a given day
}

/** Play one simulated day for a student, so dashboards, leagues and streaks have data. */
async function simulateDay(s: SimStudent, tenantId: string, day: Date) {
  const { rand } = s;
  if (rand() > s.activity) return;
  // Simulated history covers the quick question types; coding is left for real students.
  const skillIds = SKILLS.map((x) => x.id).filter((id) => !id.startsWith("coding.") && !id.startsWith("sql."));
  const qById = new Map(QUESTIONS.map((q) => [q.id, q]));
  let clock = day.getTime() + Math.floor(rand() * 50) * 60_000;
  const sessionsToday = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < sessionsToday; k++) {
    const input: StartInput = k === 0 && rand() < 0.6 ? { kind: "daily" } : { kind: "skill", skillId: skillIds[Math.floor(rand() * skillIds.length)]! };
    let session;
    try {
      session = await startSession(db, { userId: s.id, tenantId, now: new Date(clock) }, input);
    } catch {
      continue; // e.g. out of hearts
    }
    while (session.question && !session.finished) {
      const q = qById.get(session.question.id)!;
      // Harder questions are less likely to be right.
      const pCorrect = Math.max(0.1, s.skill - (q.difficulty - 1) * 0.15);
      const response = rand() < pCorrect ? correctResponse(q) : wrongResponse(q);
      const timeMs = 20_000 + Math.floor(rand() * 60_000);
      clock += timeMs;
      const result = await answerQuestion(db, { userId: s.id, tenantId, now: new Date(clock) }, session.id, { questionId: q.id, response, timeMs });
      session = result.session;
    }
    clock += 10 * 60_000;
  }
}

export async function seedDemo(now = new Date()): Promise<void> {
  await seedContent();
  const [existing] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
  if (existing) {
    console.log("Demo institution already exists; content refreshed.");
    return;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await createUser(null, "PlayCode Admin", "superadmin@playcode.dev", passwordHash, [{ role: "super_admin", orgUnitId: null }]);
  await createUser(null, "Content Team", "content@playcode.dev", passwordHash, [{ role: "content_manager", orgUnitId: null }]);

  const [tenant] = await db
    .insert(tenants)
    .values({ name: "Demo Institute of Technology", slug: "demo-tech", plan: "enterprise", seats: 500, validUntil: "2027-07-31" })
    .returning();
  const tenantId = tenant!.id;
  const unit = async (name: string, kind: "department" | "batch" | "section", parentId: string | null) =>
    (await db.insert(orgUnits).values({ tenantId, name, kind, parentId }).returning())[0]!;
  const cse = await unit("Computer Science", "department", null);
  const cse27 = await unit("CSE 2027", "batch", cse.id);
  const cseA = await unit("CSE 2027 - A", "section", cse27.id);
  const cseB = await unit("CSE 2027 - B", "section", cse27.id);
  const ece = await unit("Electronics", "department", null);
  const ece27 = await unit("ECE 2027", "batch", ece.id);
  const eceA = await unit("ECE 2027 - A", "section", ece27.id);

  await createUser(tenantId, "Institute Admin", "admin@demo.edu", passwordHash, [{ role: "inst_admin", orgUnitId: null }]);
  await createUser(tenantId, "Rajesh Sharma (TPO)", "tpo@demo.edu", passwordHash, [{ role: "tpo", orgUnitId: null }]);
  await createUser(tenantId, "Dr. Lakshmi Iyer (HOD CSE)", "hod.cse@demo.edu", passwordHash, [{ role: "hod", orgUnitId: cse.id }]);
  const faculty = await createUser(tenantId, "Prof. Anil Kumar", "faculty@demo.edu", passwordHash, [{ role: "faculty", orgUnitId: cseA.id }]);

  const sections = [cseA, cseA, cseB, eceA];
  const students: { id: string; section: string }[] = [];
  const demoStudent = await createUser(tenantId, "Riya Kapoor", "student@demo.edu", passwordHash, [{ role: "student", orgUnitId: cseA.id }], "CSE27A001");
  students.push({ id: demoStudent.id, section: cseA.id });
  for (let i = 0; i < 30; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const section = sections[i % sections.length]!;
    const prefix = section.id === eceA.id ? "ECE27A" : section.id === cseB.id ? "CSE27B" : "CSE27A";
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}${i + 1}@demo.edu`;
    const user = await createUser(tenantId, name, email, passwordHash, [{ role: "student", orgUnitId: section.id }], `${prefix}${String(i + 2).padStart(3, "0")}`);
    students.push({ id: user.id, section: section.id });
  }

  console.log("Simulating two weeks of practice...");
  const sims: SimStudent[] = students.map((s, i) => {
    const rand = seededRandom(1000 + i);
    // A spread of strong/weak and regular/occasional students, plus a few who never start.
    const activity = i === 0 ? 0.85 : i % 9 === 8 ? 0 : 0.25 + rand() * 0.65;
    return { id: s.id, rand: seededRandom(77 + i), skill: 0.35 + rand() * 0.55, activity };
  });
  let lastWeek: string | null = null;
  for (let d = 14; d >= 1; d--) {
    // Mid-afternoon India time on that day.
    const day = new Date(now.getTime() - d * 86_400_000);
    day.setUTCHours(9, 0, 0, 0);
    const week = isoWeekKey(localDate(day, tenant!.timeZone));
    // The weekly job closes the previous week before the new one starts.
    if (lastWeek && week !== lastWeek) await db.transaction((tx) => closeLeagueWeek(tx, tenantId, lastWeek!));
    lastWeek = week;
    for (const sim of sims) await simulateDay(sim, tenantId, day);
  }
  const currentWeek = isoWeekKey(localDate(now, tenant!.timeZone));
  if (lastWeek && lastWeek !== currentWeek) await db.transaction((tx) => closeLeagueWeek(tx, tenantId, lastWeek!));

  const loopQuestions = QUESTIONS.filter((q) => q.skillId.startsWith("loops.")).map((q) => q.id);
  await db.insert(assignments).values([
    {
      tenantId,
      title: "Loops practice - Week 1",
      questionIds: loopQuestions,
      orgUnitIds: [cseA.id],
      openAt: new Date(now.getTime() - 3 * 86_400_000),
      closeAt: new Date(now.getTime() + 4 * 86_400_000),
      createdBy: faculty.id,
    },
    {
      tenantId,
      title: "Mock drive: service-company pseudocode",
      packId: "mission-service-pseudocode",
      questionIds: PACKS[0]!.questionIds,
      orgUnitIds: [cse27.id, ece27.id],
      openAt: new Date(now.getTime() - 86_400_000),
      closeAt: new Date(now.getTime() + 6 * 86_400_000),
      createdBy: faculty.id,
    },
  ]);
  const pool = (skillPrefix: string[]) => QUESTIONS.filter((q) => skillPrefix.some((p) => q.skillId.startsWith(p))).map((q) => q.id);
  await db.insert(assessments).values({
    tenantId,
    title: "Mock placement drive 1",
    instructions: "Two sections. Section A has negative marking. Use any language for the coding problem.",
    proctorLevel: 1,
    durationMinutes: 45,
    openAt: new Date(now.getTime() - 3600_000),
    closeAt: new Date(now.getTime() + 2 * 86_400_000),
    sections: [
      { title: "A: Output and pseudocode", questionIds: pool(["pseudocode.", "loops.", "basics."]), pick: 8, marks: 1, negative: 0.25 },
      { title: "B: Coding", questionIds: pool(["coding."]), pick: 1, marks: 10, negative: 0 },
    ],
    orgUnitIds: [cse27.id],
    releasePolicy: "manual",
    createdBy: faculty.id,
  });
  const tpoUser = (await db.select().from(users).where(eq(users.email, "tpo@demo.edu")))[0]!;
  await db.insert(competitions).values({
    tenantId,
    title: "Code Premier League: Week 43",
    description: "CSE A vs CSE B vs ECE A. Highest XP per student wins the trophy.",
    scope: "sections",
    teamIds: [cseA.id, cseB.id, eceA.id],
    startsAt: new Date(now.getTime() - 3 * 86_400_000),
    endsAt: new Date(now.getTime() + 4 * 86_400_000),
    createdBy: tpoUser.id,
  });
  // A placement-prep learning path for the CSE batch.
  await createPath(db, {
    tenantId,
    actorId: tpoUser.id,
    title: "Service company placement track",
    description: "Four weeks to TCS/Infosys/Wipro readiness: loops and arrays first, then the pseudocode mission.",
    unitIds: [cse27.id],
    steps: [
      { kind: "skill", ref: "loops.for", target: 50, dueDays: 7 },
      { kind: "skill", ref: "arrays.basics", target: 50, dueDays: 14 },
      { kind: "skill", ref: "pseudocode.basics", target: 50, dueDays: 21 },
      { kind: "pack", ref: "mission-service-pseudocode", dueDays: 28 },
    ],
    sequential: true,
    startsAt: new Date(now.getTime() - 10 * 86_400_000),
  });
  // Placement season: academic records, finished drives with results, and drives open now.
  await seedPlacements({
    tenantId,
    tpoId: tpoUser.id,
    students: students.map((s, i) => ({ id: s.id, section: s.section === eceA.id ? "ece" : "cse", activity: sims[i]!.activity, skill: sims[i]!.skill })),
    cseUnitId: cse.id,
    now,
  });
  await seedInterview({ tenantId, userId: demoStudent.id, now });
  await seedRecruiters({ tenantId, tpoId: tpoUser.id, departments: { cse: cse.id, ece: ece.id }, now });
  await seedJoiningAndOpenings({ tenantId, tpoId: tpoUser.id, undecided: students.slice(0, 4).map((s) => s.id), students: students.map((s) => s.id), now });
  await seedAlumni({ tenantId, studentId: students[5]!.id, now });
  await seedPeer({ tenantId, students: students.map((s) => s.id), now });
  // Two students reported the same question, so the content team's review queue has something in it.
  const [reported] = await db
    .select({ questionId: responses.questionId, version: questions.version })
    .from(responses)
    .innerJoin(questions, eq(questions.id, responses.questionId))
    .where(and(eq(responses.userId, students[1]!.id), sql`${questions.type} = 'predict_output'`))
    .limit(1);
  if (reported) {
    await db.insert(questionReports).values([
      { questionId: reported.questionId, questionVersion: reported.version, userId: students[1]!.id, tenantId, reason: "unclear", note: "Does end=' ' add a space after the last number too?", createdAt: new Date(now.getTime() - 86_400_000) },
      { questionId: reported.questionId, questionVersion: reported.version, userId: students[5]!.id, tenantId, reason: "wrong_answer", note: "", createdAt: new Date(now.getTime() - 3_600_000) },
    ]);
  }
  // A student who never started has asked for their data to be deleted.
  await requestErasure(db, { tenantId, userId: students[26]!.id, reason: "I have left the college.", now: new Date(now.getTime() - 2 * 86_400_000) });
  // A training partner reselling PlayCode under its own brand, with one college.
  const [partner] = await db
    .insert(tenants)
    .values({ name: "SkillBridge Training Partners", slug: "skillbridge", type: "partner", plan: "enterprise", seats: 2000, branding: { appName: "SkillBridge Code", primaryColor: "#0f766e", certificateSignatory: "Head of Academics, SkillBridge" } })
    .returning();
  await createUser(partner!.id, "SkillBridge Admin", "partner@skillbridge.in", passwordHash, [{ role: "partner_admin", orgUnitId: null }]);
  const [sunrise] = await db.insert(tenants).values({ name: "Sunrise Engineering College", slug: "sunrise", parentId: partner!.id, seats: 300 }).returning();
  await createUser(sunrise!.id, "Sunrise Admin", "admin@sunrise.edu", passwordHash, [{ role: "inst_admin", orgUnitId: null }]);
  const [sunriseBatch] = await db.insert(orgUnits).values({ tenantId: sunrise!.id, name: "CSE 2027", kind: "batch", parentId: null }).returning();
  for (let i = 0; i < 4; i++) {
    await createUser(sunrise!.id, `${FIRST[(i + 11) % FIRST.length]} ${LAST[(i + 3) % LAST.length]}`, `sunrise.student${i + 1}@sunrise.edu`, passwordHash, [{ role: "student", orgUnitId: sunriseBatch!.id }], `SEC27${String(i + 1).padStart(3, "0")}`);
  }

  // A hiring company with one drive and a few candidates who took the test.
  const [acme] = await db.insert(tenants).values({ name: "Acme Technologies", slug: "acme", type: "company", seats: 1000, branding: { appName: "Acme Careers", primaryColor: "#1d4ed8" } }).returning();
  const hr = await createUser(acme!.id, "Neha Kapoor (HR)", "hr@acme.dev", passwordHash, [{ role: "inst_admin", orgUnitId: null }]);
  await createUser(acme!.id, "Vikram Shah (Recruiter)", "recruiter@acme.dev", passwordHash, [{ role: "recruiter", orgUnitId: null }]);
  const drive = await createDrive(db, {
    tenantId: acme!.id,
    actorId: hr.id,
    title: "Campus hiring 2027",
    roleTitle: "Graduate Engineer Trainee",
    description: "One aptitude section and one coding problem. Use any language.",
    durationMinutes: 60,
    openAt: new Date(now.getTime() - 2 * 86_400_000),
    closeAt: new Date(now.getTime() + 12 * 86_400_000),
    proctorLevel: 1,
    cutoffPct: 50,
    sections: [
      { title: "Aptitude for code", skillIds: ["loops.for", "loops.while", "arrays.basics", "pseudocode.basics"], pick: 6, marks: 1, negative: 0.25 },
      { title: "Coding", skillIds: ["coding.basics"], pick: 1, marks: 10, negative: 0 },
    ],
    packQuestionIds: async () => [],
  });
  const byIdQ = new Map(QUESTIONS.map((q) => [q.id, q]));
  for (const [i, c] of [
    { name: "Ishaan Bose", email: "ishaan.bose@example.com", college: "Demo Institute of Technology", right: 1 },
    { name: "Fatima Shaikh", email: "fatima.shaikh@example.com", college: "Sunrise Engineering College", right: 0.6 },
    { name: "Gaurav Menon", email: "gaurav.menon@example.com", college: "City College", right: -1 },
  ].entries()) {
    const applied = await applyToDrive(db, drive.inviteCode, { name: c.name, email: c.email, password: DEMO_PASSWORD, college: c.college }, new Date(now.getTime() - 86_400_000 + i * 3600_000));
    if (c.right < 0) continue; // applied but has not taken the test yet
    const userId = (await db.select().from(users).where(eq(users.email, c.email)))[0]!.id;
    const ctx = { userId, tenantId: acme!.id, now: new Date(now.getTime() - 20 * 3600_000 + i * 3600_000) };
    const attempt = await startAttempt(db, ctx, applied.assessmentId, `seed-device-${i}`);
    for (const [k, q] of attempt.questions.entries()) {
      const seedQ = byIdQ.get(q.question.id)!;
      const right = k / attempt.questions.length < c.right;
      await saveAnswer(db, ctx, attempt.id, { questionId: q.question.id, response: right ? correctResponse(seedQ) : wrongResponse(seedQ) });
    }
    await submitOwn(db, { ...ctx, now: new Date(ctx.now.getTime() + 40 * 60_000) }, attempt.id);
  }

  // The talent pool: the demo college opens it, some students join, and Acme (on Enterprise) invites one.
  await db.update(tenants).set({ plan: "enterprise" }).where(eq(tenants.id, acme!.id));
  const [demoAdmin] = await db.select().from(users).where(eq(users.email, "admin@demo.edu"));
  await setInstitutionPool(db, { tenantId, actorId: demoAdmin!.id, open: true });
  for (const [i, s] of students.slice(0, 10).entries()) {
    await setDiscoverable(db, { tenantId, userId: s.id, now: new Date(now.getTime() - 5 * 86_400_000) }, { discoverable: true, lookingFor: i % 3 === 0 ? { locations: ["Bengaluru", "Pune"] } : {} });
  }
  await sendInvite(db, { tenantId: acme!.id, userId: hr.id, now: new Date(now.getTime() - 3600_000) }, {
    userId: demoStudent.id,
    roleTitle: "Graduate Engineer Trainee",
    message: "Hi Riya, your loops and arrays work stood out. We are hiring graduate engineers in Pune and Bengaluru; take our campus test if you are interested.",
    driveId: drive.id,
  });

  // A coding contest running now, with a few submissions on the board.
  const contest = await createContest(db, {
    tenantId,
    actorId: demoAdmin!.id,
    input: {
      title: "Diwali coding cup",
      description: "Three problems, two hours. Any language.",
      problemIds: ["code-sum-two", "code-even-odd", "code-palindrome"],
      audienceIds: [],
      startsAt: new Date(now.getTime() - 40 * 60_000),
      endsAt: new Date(now.getTime() + 80 * 60_000),
      freezeMinutes: 20,
    },
    now,
  });
  const byCode = new Map(QUESTIONS.map((q) => [q.id, q]));
  const attempts: [number, string, "accepted" | "wrong_answer", number][] = [
    [1, "code-sum-two", "accepted", 6],
    [1, "code-even-odd", "wrong_answer", 15],
    [1, "code-even-odd", "accepted", 22],
    [2, "code-sum-two", "accepted", 9],
    [3, "code-sum-two", "wrong_answer", 12],
    [3, "code-sum-two", "accepted", 18],
    [3, "code-palindrome", "accepted", 35],
    [4, "code-even-odd", "wrong_answer", 30],
  ];
  for (const [i, questionId, verdict, minute] of attempts) {
    const q = byCode.get(questionId)!;
    const tests = q.answer.kind === "tests" ? q.answer.tests.length : 1;
    await db.insert(contestSubmissions).values({
      contestId: contest.id,
      userId: students[i]!.id,
      tenantId,
      questionId,
      response: { kind: "code", language: "python", source: verdict === "accepted" ? q.solutions!.python! : "print(0)" },
      verdict,
      passed: verdict === "accepted" ? tests : 1,
      total: tests,
      createdAt: new Date(contest.startsAt.getTime() + minute * 60_000),
    });
  }

  // A peer-benchmark snapshot for the demo college (comparisons appear once there are 5 measured peers).
  await snapshotBenchmarks(db, now);

  console.log(`Seeded demo institution with ${students.length} students. Password for every account: ${DEMO_PASSWORD}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  await seedDemo();
  await pool.end();
}
