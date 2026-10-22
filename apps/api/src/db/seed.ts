import { eq, sql } from "drizzle-orm";
import {
  initialQuestionRating,
  isoWeekKey,
  localDate,
  seededRandom,
  type Answer,
  type Role,
  type StudentResponse,
} from "@playcode/core";
import { PACKS } from "../content/packs";
import { QUESTIONS } from "../content/questions";
import { SKILLS } from "../content/skills";
import { hashPassword } from "../lib/auth";
import { closeLeagueWeek } from "../services/leagues";
import { answerQuestion, startSession, type StartInput } from "../services/practice";
import { db, pool, type Db } from "./client";
import { runMigrations } from "./migrate";
import { assignments, memberships, orgUnits, packs, questions, skills, tenants, users } from "./schema";

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

function correctResponse(answer: Answer): StudentResponse {
  switch (answer.kind) {
    case "option":
      return { kind: "option", optionId: answer.optionId };
    case "text":
      return { kind: "text", value: answer.accepted[0]! };
    case "lines":
      return { kind: "lines", lines: answer.lines };
    case "order":
      return { kind: "order", ids: answer.orders[0]! };
  }
}

function wrongResponse(answer: Answer, options: string[]): StudentResponse {
  switch (answer.kind) {
    case "option":
      return { kind: "option", optionId: options.find((o) => o !== answer.optionId) ?? "z" };
    case "text":
      return { kind: "text", value: "not sure" };
    case "lines":
      return { kind: "lines", lines: [answer.lines[0]! === 1 ? 2 : 1] };
    case "order":
      return { kind: "order", ids: [...answer.orders[0]!].reverse() };
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
  const skillIds = SKILLS.map((x) => x.id);
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
      const response = rand() < pCorrect ? correctResponse(q.answer) : wrongResponse(q.answer, q.body.options?.map((o) => o.id) ?? []);
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
    .values({ name: "Demo Institute of Technology", slug: "demo-tech", plan: "pro", seats: 500, validUntil: "2027-07-31" })
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
  console.log(`Seeded demo institution with ${students.length} students. Password for every account: ${DEMO_PASSWORD}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  await seedDemo();
  await pool.end();
}
