import { checkEligibility, seededRandom, type AcademicRecord, type PlacementCriteria } from "@playcode/core";
import { createDrive } from "../services/placements";
import { db } from "./client";
import { academicRecords, interviews, placementApplications, placementDrives, type ApplicationStatus, type InterviewTurn } from "./schema";

const DAY_MS = 86_400_000;

/**
 * Placement season for the demo college: academic records, three finished
 * drives with results, and two open drives. Students who practised more and
 * scored higher readiness do better, so the outcome report has a story to tell.
 */
export async function seedPlacements(args: {
  tenantId: string;
  tpoId: string;
  students: { id: string; section: string; activity: number; skill: number }[];
  cseUnitId: string;
  now: Date;
}) {
  const { tenantId, tpoId, now } = args;
  const rand = seededRandom(4242);
  const records = new Map<string, AcademicRecord>();
  for (const [i, s] of args.students.entries()) {
    const record: AcademicRecord = {
      cgpa: i === 0 ? 8.1 : Math.round((6 + rand() * 3.4) * 10) / 10,
      backlogs: i === 0 ? 0 : rand() < 0.15 ? 1 + Math.floor(rand() * 2) : 0,
      tenthPct: Math.round(62 + rand() * 33),
      twelfthPct: Math.round(58 + rand() * 37),
      graduationYear: 2027,
    };
    records.set(s.id, record);
    await db.insert(academicRecords).values({ userId: s.id, tenantId, ...record, updatedBy: tpoId, updatedAt: now });
  }
  // Readiness when the season started, after a semester of practice (the simulated history only covers two weeks).
  const readiness = new Map(
    args.students.map((s) => {
      const service = Math.round(100 * s.skill * (0.45 + 0.55 * s.activity));
      return [s.id, { service, product: Math.max(0, service - 12) }];
    }),
  );
  // Practice days in the 60 days before the season, from how active each student is.
  const days = new Map(args.students.map((s) => [s.id, Math.round(s.activity * s.activity * 60 * (0.8 + rand() * 0.4))]));

  const past: { company: string; type: "service" | "product"; role: string; ctc: number; date: string; rounds: string[]; criteria: PlacementCriteria; bar: number }[] = [
    {
      company: "TCS",
      type: "service",
      role: "Assistant System Engineer (Ninja)",
      ctc: 336_000,
      date: "2026-08-27",
      rounds: ["National Qualifier Test", "Technical interview", "HR interview"],
      criteria: { unitIds: [], minCgpa: 6, maxBacklogs: 0, min10th: 60, min12th: 60, graduationYears: [2027] },
      bar: 0.45,
    },
    {
      company: "Infosys",
      type: "service",
      role: "Systems Engineer",
      ctc: 360_000,
      date: "2026-09-17",
      rounds: ["Online assessment", "Interview"],
      criteria: { unitIds: [], minCgpa: 6, maxBacklogs: 0, graduationYears: [2027] },
      bar: 0.5,
    },
    {
      company: "Zoho",
      type: "product",
      role: "Member Technical Staff",
      ctc: 720_000,
      date: "2026-10-08",
      rounds: ["Written test", "Programming round", "Technical interview", "HR interview"],
      criteria: { unitIds: [args.cseUnitId], minCgpa: 7, maxBacklogs: 0, graduationYears: [2027], allowPlaced: true },
      bar: 0.7,
    },
  ];
  const placed = new Set<string>();
  for (const d of past) {
    const driveDay = new Date(`${d.date}T04:30:00Z`);
    const [drive] = await db
      .insert(placementDrives)
      .values({
        tenantId,
        company: d.company,
        companyType: d.type,
        roleTitle: d.role,
        description: "",
        ctcRupees: d.ctc,
        location: d.type === "product" ? "Chennai" : "Pan India",
        driveDate: d.date,
        registerBy: new Date(driveDay.getTime() - 5 * DAY_MS),
        criteria: d.criteria,
        rounds: d.rounds,
        status: "completed",
        createdBy: tpoId,
        createdAt: new Date(driveDay.getTime() - 14 * DAY_MS),
      })
      .returning();
    for (const [i, s] of args.students.entries()) {
      const inUnits = d.criteria.unitIds.length === 0 || s.section === "cse";
      if (!checkEligibility(d.criteria, records.get(s.id)!, { inUnits, placed: placed.has(s.id) }).eligible) continue;
      // The demo student only tried Zoho, and is still looking.
      if (i === 0 && d.company !== "Zoho") continue;
      if (i !== 0 && rand() < 0.12) continue; // some eligible students skip a drive
      const r = readiness.get(s.id)![d.type];
      const practice = days.get(s.id)!;
      // Each round is passed with a chance that grows with readiness and practice.
      const pRound = Math.min(0.95, 0.35 + (r / 100) * 0.6 + (practice / 60) * 0.35 - (d.bar - 0.5));
      let cleared = 0;
      while (cleared < d.rounds.length && rand() < pRound) cleared++;
      let status: ApplicationStatus = cleared === d.rounds.length ? "offered" : "rejected";
      if (i === 0) {
        cleared = 2;
        status = "rejected";
      }
      if (status === "offered") placed.add(s.id);
      await db.insert(placementApplications).values({
        driveId: drive!.id,
        userId: s.id,
        tenantId,
        status,
        roundsCleared: cleared,
        offerCtcRupees: status === "offered" ? d.ctc : null,
        readiness: readiness.get(s.id)!,
        activeDays60: practice,
        createdAt: new Date(driveDay.getTime() - 8 * DAY_MS),
        updatedAt: driveDay,
      });
    }
  }

  // Open now: a mass recruiter and a dream-company drive.
  await createDrive(db, {
    tenantId,
    actorId: tpoId,
    now,
    company: "Accenture",
    companyType: "service",
    roleTitle: "Associate Software Engineer",
    description: "Cognitive and technical assessment, coding round, then a communication assessment and interview. Bring two copies of your resume.",
    ctcRupees: 450_000,
    location: "Bengaluru, Hyderabad, Pune",
    driveDate: new Date(now.getTime() + 14 * DAY_MS).toISOString().slice(0, 10),
    registerBy: new Date(now.getTime() + 5 * DAY_MS),
    criteria: { unitIds: [], minCgpa: 6.5, maxBacklogs: 1, min10th: 60, min12th: 60, graduationYears: [2027] },
    rounds: ["Cognitive and technical assessment", "Coding round", "Communication assessment", "Interview"],
    packId: "mission-service-pseudocode",
  });
  await createDrive(db, {
    tenantId,
    actorId: tpoId,
    now,
    company: "Freshworks",
    companyType: "product",
    roleTitle: "Software Engineer",
    description: "Open to students who already hold an offer. Online DSA test, two technical interviews and a hiring-manager round.",
    ctcRupees: 1_200_000,
    location: "Chennai",
    driveDate: new Date(now.getTime() + 21 * DAY_MS).toISOString().slice(0, 10),
    registerBy: new Date(now.getTime() + 9 * DAY_MS),
    criteria: { unitIds: [args.cseUnitId], minCgpa: 7.5, maxBacklogs: 0, graduationYears: [2027], allowPlaced: true },
    rounds: ["Online DSA test", "Technical interview 1", "Technical interview 2", "Hiring manager round"],
    packId: "mission-product-dsa",
  });
}

/** One finished mock interview for the demo student, so the scorecard and the teachers' view have data. */
export async function seedInterview(args: { tenantId: string; userId: string; now: Date }) {
  const at = new Date(args.now.getTime() - 9 * DAY_MS);
  const lines: [InterviewTurn["role"], string][] = [
    ["interviewer", "Hi Riya, thanks for joining. Let's start simple: what is the difference between a `while` loop and a `do-while` loop?"],
    ["candidate", "A while loop checks the condition first, so it may not run at all. A do-while runs the body once and then checks, so it always runs at least once. I'd use do-while for a menu that must show once."],
    ["interviewer", "Good example. Now, how would you reverse an array in place? What is the time and space complexity?"],
    ["candidate", "Use two pointers, one at the start and one at the end, swap and move them inward until they meet. It is O(n) time and O(1) extra space."],
    ["interviewer", "Nice. What happens with your approach if the array has an odd length?"],
    ["candidate", "The middle element stays where it is, the loop stops when start equals end. I think the condition should be start < end."],
    ["interviewer", "Correct. Last one: in pseudocode, what does this print? `x = 5; for i = 1 to 3: x = x + i; print x`"],
    ["candidate", "It adds 1, 2 and 3, so 11."],
    ["interviewer", "That's right. Thanks Riya, that's all for today. Your scorecard is below."],
  ];
  await db.insert(interviews).values({
    tenantId: args.tenantId,
    userId: args.userId,
    track: "service",
    focusSkills: ["loops.while", "arrays.basics", "pseudocode.basics"],
    status: "finished",
    turns: lines.map(([role, text], i) => ({ role, text, at: new Date(at.getTime() + i * 60_000).toISOString() })),
    scorecard: {
      scores: { problemSolving: 4, fundamentals: 4, communication: 4, code: 3 },
      overall: 4,
      strengths: ["Gave a real use case for do-while (a menu that must show once).", "Stated the time and space complexity of the two-pointer reversal unprompted."],
      improvements: ["Think about edge cases before being asked: odd lengths, empty arrays.", "Write the loop condition precisely the first time (start < end)."],
      summary: "You answered clearly and in order, and your fundamentals are solid for service-company interviews. Push yourself to cover edge cases on your own.",
      practise: ["arrays.basics", "loops.while"],
    },
    startedAt: at,
    finishedAt: new Date(at.getTime() + 9 * 60_000),
  });
}
