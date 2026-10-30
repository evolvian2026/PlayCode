import { checkEligibility, localDate, seededRandom, type AcademicRecord, type CompanyStage, type InteractionKind, type PlacementCriteria } from "@playcode/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { sha256 } from "../lib/crypto";
import { createDrive } from "../services/placements";
import { db } from "./client";
import { academicRecords, interviews, placementApplications, placementDrives, alumni, alumniIntros, peerFeedback, peerRequests, peerSessions, onDutyRequests, resumeEntries, openingResponses, placementOpenings, placementTargets, recruiterFeedback, recruiterContacts, recruiterInteractions, recruiters, tenants, type ApplicationStatus, type InterviewTurn } from "./schema";

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

/**
 * The placement cell's company list: the companies that came this season,
 * two being talked to (one follow-up due today, one overdue), and a season
 * target for the batch.
 */
export async function seedRecruiters(args: { tenantId: string; tpoId: string; departments: { cse: string; ece: string }; now: Date }) {
  const { tenantId, tpoId, now } = args;
  const day = (offset: number) => localDate(new Date(now.getTime() + offset * DAY_MS), "Asia/Kolkata");
  const companies: { name: string; sector: string; stage: CompanyStage; website: string | null; contact?: [string, string, string, string]; log: [InteractionKind, number, string, number | null][] }[] = [
    { name: "TCS", sector: "IT services", stage: "visited", website: "https://www.tcs.com", contact: ["Meera Iyer", "Campus relations, Chennai", "meera.iyer@tcs.example", "+91 98400 11223"], log: [["visit", -63, "NQT on campus, 3 rounds. Asked for the 2028 batch list by June.", null]] },
    { name: "Infosys", sector: "IT services", stage: "visited", website: "https://www.infosys.com", log: [["visit", -42, "Online assessment and interviews in one day.", null]] },
    { name: "Zoho", sector: "Product", stage: "visited", website: "https://www.zoho.com", contact: ["Karthik R", "Talent acquisition", "karthik.r@zoho.example", ""], log: [["visit", -21, "Programming round was tough; only CSE eligible. Open to ECE next year if CGPA is 7.5+.", null]] },
    { name: "Accenture", sector: "IT services", stage: "confirmed", website: "https://www.accenture.com", log: [["email", -6, "Drive confirmed, registration open on PlayCode.", null]] },
    { name: "Wipro", sector: "IT services", stage: "in_talks", website: "https://www.wipro.com", contact: ["Sanjay Gupta", "University relations", "sanjay.gupta@wipro.example", "+91 99000 44556"], log: [["call", -8, "Interested in an Elite NTH drive in December. Wants last year's numbers and the brochure.", 0]] },
    { name: "Freshworks", sector: "Product (SaaS)", stage: "confirmed", website: "https://www.freshworks.com", log: [["meeting", -9, "Drive confirmed for CSE; they will share the test link a day before.", null]] },
    { name: "Juspay", sector: "Product (fintech)", stage: "prospect", website: "https://juspay.in", log: [["email", -12, "Sent the brochure to their campus team.", -2]] },
    { name: "Deloitte", sector: "Consulting", stage: "not_interested", website: null, log: [["call", -30, "Hiring only from tier-1 colleges this year. Try again in July.", null]] },
  ];
  for (const c of companies) {
    const [r] = await db.insert(recruiters).values({ tenantId, name: c.name, sector: c.sector, stage: c.stage, website: c.website, ownerId: tpoId, createdAt: now, updatedAt: now }).returning();
    if (c.contact) await db.insert(recruiterContacts).values({ recruiterId: r!.id, name: c.contact[0], designation: c.contact[1], email: c.contact[2] || null, phone: c.contact[3] || null, createdAt: now });
    for (const [kind, on, note, follow] of c.log) await db.insert(recruiterInteractions).values({ recruiterId: r!.id, tenantId, kind, on: day(on), note, followUpOn: follow === null ? null : day(follow), byId: tpoId, createdAt: now });
  }
  const brochure = {
    about: "Demo Institute of Technology was founded in 1998 and is affiliated to the state technical university. Our 2027 batch studies Computer Science and Electronics, and every student trains for placements from the second year: coding, aptitude, communication and mock interviews, with their progress tracked on PlayCode.",
    contactName: "Rajesh Sharma",
    contactRole: "Training and Placement Officer",
    contactEmail: "placements@demo.edu",
    contactPhone: "+91 80 4000 1234",
  };
  await db.update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ brochure })}::jsonb` }).where(eq(tenants.id, tenantId));
  // Two companies have said how the students did; Zoho hasn't answered yet.
  const drives = await db.select({ id: placementDrives.id, company: placementDrives.company }).from(placementDrives).where(eq(placementDrives.tenantId, tenantId));
  const driveOf = (c: string) => drives.find((d) => d.company === c)!.id;
  const link = (c: string) => ({ tenantId, driveId: driveOf(c), tokenHash: sha256(`seed-feedback:${tenantId}:${c}`), sentTo: null, createdBy: tpoId, createdAt: new Date(now.getTime() - 10 * DAY_MS) });
  await db.insert(recruiterFeedback).values([
    {
      ...link("TCS"),
      ratings: { aptitude: 4, technical: 3, communication: 2, preparedness: 3 },
      wentWell: "Strong on the aptitude section; most cleared the NQT comfortably.",
      gaps: "Many struggled to explain their final-year project in English, and a few hadn't read about TCS at all.",
      returnNextYear: "yes" as const,
      plannedHires: 25,
      respondentName: "Meera Iyer",
      respondentRole: "Campus relations",
      submittedAt: new Date(now.getTime() - 8 * DAY_MS),
    },
    {
      ...link("Infosys"),
      ratings: { aptitude: 4, technical: 3, communication: 3, preparedness: 2 },
      wentWell: "Punctual and well organised drive; students were keen.",
      gaps: "Resumes were weak: no projects or numbers. Several came without printed copies.",
      returnNextYear: "yes" as const,
      plannedHires: 20,
      respondentName: "HR team",
      respondentRole: "",
      submittedAt: new Date(now.getTime() - 5 * DAY_MS),
    },
    link("Zoho"),
  ]);
  await db.insert(placementTargets).values([
    { tenantId, graduationYear: 2027, unitId: null, targetPct: 80, updatedBy: tpoId, updatedAt: now },
    { tenantId, graduationYear: 2027, unitId: args.departments.cse, targetPct: 85, updatedBy: tpoId, updatedAt: now },
    { tenantId, graduationYear: 2027, unitId: args.departments.ece, targetPct: 70, updatedBy: tpoId, updatedAt: now },
  ]);
}

/**
 * Where accepted offers stand: most students have accepted theirs (the first
 * few still have to answer), with offer letters and joining dates coming in,
 * one early joining date missed, and openings found off campus.
 */
export async function seedJoiningAndOpenings(args: { tenantId: string; tpoId: string; undecided: string[]; students: string[]; now: Date }) {
  const { tenantId, now } = args;
  const day = (offset: number) => localDate(new Date(now.getTime() + offset * DAY_MS), "Asia/Kolkata");
  const offered = await db
    .select({ driveId: placementApplications.driveId, userId: placementApplications.userId, company: placementDrives.company })
    .from(placementApplications)
    .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
    .where(and(eq(placementApplications.tenantId, tenantId), eq(placementApplications.status, "offered")))
    .orderBy(desc(placementApplications.offerCtcRupees));
  const skip = new Set(args.undecided);
  const counts = new Map<string, number>();
  const taken = new Set<string>();
  for (const o of offered) {
    if (skip.has(o.userId)) continue;
    // Students with two offers took the better one.
    if (taken.has(o.userId)) {
      await db.update(placementApplications).set({ decision: "declined", decidedAt: now }).where(and(eq(placementApplications.driveId, o.driveId), eq(placementApplications.userId, o.userId)));
      continue;
    }
    taken.add(o.userId);
    const i = counts.get(o.company) ?? 0;
    counts.set(o.company, i + 1);
    const joining: Partial<typeof placementApplications.$inferInsert> =
      o.company === "Zoho"
        ? { joiningStatus: "date_given", joiningDate: "2027-07-01" }
        : o.company === "Infosys"
          ? i === 0
            ? { joiningStatus: "date_given", joiningDate: day(-10), joiningNote: "Asked to join early as an intern, then nothing." }
            : { joiningStatus: i % 2 ? "letter_received" : "awaiting_letter" }
          : i % 3 === 0
            ? { joiningStatus: "letter_received" }
            : {};
    await db
      .update(placementApplications)
      .set({ decision: "accepted", decidedAt: now, ...joining, joiningUpdatedAt: joining.joiningStatus ? now : null })
      .where(and(eq(placementApplications.driveId, o.driveId), eq(placementApplications.userId, o.userId)));
  }

  const [amazon, poolDrive] = await db
    .insert(placementOpenings)
    .values([
      {
        tenantId,
        kind: "off_campus" as const,
        company: "Amazon",
        roleTitle: "SDE I (2027 graduates)",
        payRupees: 2_400_000,
        location: "Bengaluru, Hyderabad",
        details: "Online assessment with two coding questions and a work-style survey. Apply with your college email.",
        applyUrl: "https://www.amazon.jobs/",
        closesOn: day(9),
        criteria: { unitIds: [], minCgpa: 7, maxBacklogs: 0, graduationYears: [2027], allowPlaced: true },
        createdBy: args.tpoId,
        createdAt: new Date(now.getTime() - 2 * DAY_MS),
      },
      {
        tenantId,
        kind: "pool_campus" as const,
        company: "Cognizant",
        roleTitle: "Programmer Analyst Trainee",
        payRupees: 400_000,
        location: "Pool drive at City Engineering College, Pune",
        details: "Report at 8:30 with two copies of your resume, college ID and mark sheets. Register on the link first.",
        applyUrl: "https://careers.cognizant.com/",
        closesOn: day(1),
        criteria: { unitIds: [], maxBacklogs: 1, graduationYears: [2027], allowPlaced: false },
        createdBy: args.tpoId,
        createdAt: new Date(now.getTime() - 5 * DAY_MS),
      },
      {
        tenantId,
        kind: "internship" as const,
        company: "IISc Bangalore",
        roleTitle: "Summer research internship",
        payRupees: 12_000,
        location: "Bengaluru",
        details: "Eight weeks in May and June. Needs a statement of purpose and a faculty recommendation.",
        applyUrl: "https://iisc.ac.in/",
        closesOn: day(20),
        criteria: { unitIds: [], minCgpa: 8, graduationYears: [2027, 2028], allowPlaced: true },
        createdBy: args.tpoId,
        createdAt: new Date(now.getTime() - DAY_MS),
      },
    ])
    .returning();
  // What the two open drives' offers are made of.
  await db.update(placementDrives).set({ offerDetails: { fixedRupees: 1_050_000, variableRupees: 150_000, probationMonths: 6, notes: "Variable pay is paid yearly on company and individual performance." } }).where(and(eq(placementDrives.tenantId, tenantId), eq(placementDrives.company, "Freshworks")));
  await db.update(placementDrives).set({ offerDetails: { fixedRupees: 450_000, probationMonths: 6 } }).where(and(eq(placementDrives.tenantId, tenantId), eq(placementDrives.company, "Accenture")));
  // A few students who fit have already answered: two applied to Amazon, one passed on the pool drive.
  const records = await db.select().from(academicRecords).where(eq(academicRecords.tenantId, tenantId));
  const holding = new Set(offered.map((o) => o.userId));
  const fits = (id: string, ok: (r: (typeof records)[number]) => boolean) => records.some((r) => r.userId === id && ok(r));
  const others = args.students.slice(1);
  const [a, b] = others.filter((id) => fits(id, (r) => (r.cgpa ?? 0) >= 7 && r.backlogs === 0));
  const c = others.find((id) => !holding.has(id) && fits(id, (r) => (r.backlogs ?? 9) <= 1));
  await db.insert(openingResponses).values([
    { openingId: amazon!.id, userId: a!, tenantId, response: "applied" as const, updatedAt: now },
    { openingId: amazon!.id, userId: b!, tenantId, response: "applied" as const, updatedAt: now },
    { openingId: poolDrive!.id, userId: c!, tenantId, response: "not_interested" as const, updatedAt: now },
  ]);
}

/** Graduates the placement cell keeps in touch with, and one student waiting for an introduction. */
export async function seedAlumni(args: { tenantId: string; studentId: string; now: Date }) {
  const { tenantId, now } = args;
  const rows = await db
    .insert(alumni)
    .values(
      (
        [
          ["Priyanka Desai", "priyanka.desai@example.com", 2022, "Computer Science", "Zoho", "Member Technical Staff", "Chennai", true, true],
          ["Arjun Menon", "arjun.menon@example.com", 2021, "Computer Science", "Amazon", "SDE II", "Bengaluru", true, true],
          ["Farhan Shaikh", "farhan.shaikh@example.com", 2023, "Electronics", "Infosys", "Systems Engineer", "Pune", false, true],
          ["Lakshmi Narayan", "lakshmi.n@example.com", 2020, "Computer Science", "Freshworks", "Senior Software Engineer", "Chennai", true, true],
          ["Rohit Kulkarni", "rohit.k@example.com", 2019, "Electronics", "Texas Instruments", "Design Engineer", "Bengaluru", false, true],
          ["Neha Joshi", "neha.joshi@example.com", 2022, "Computer Science", "TCS", "Systems Engineer", "Mumbai", true, false],
        ] as const
      ).map(([name, email, graduationYear, department, company, role, city, openToReferrals, openToAdvice]) => ({ tenantId, name, email, graduationYear, department, company, role, city, openToReferrals, openToAdvice, createdAt: now })),
    )
    .returning();
  const freshworks = rows.find((r) => r.company === "Freshworks")!;
  await db.insert(alumniIntros).values({
    tenantId,
    alumnusId: freshworks.id,
    userId: args.studentId,
    purpose: "advice",
    message: "I'm a final-year CSE student preparing for the Freshworks drive next month. Could you tell me what the hiring-manager round looks for, and how you prepared for it?",
    createdAt: new Date(now.getTime() - 2 * DAY_MS),
  });
}

/** Peer practice: one past session with feedback both ways, and a student waiting for a technical partner. */
export async function seedPeer(args: { tenantId: string; students: string[]; now: Date }) {
  const { tenantId, now } = args;
  const [a, b, waiting] = [args.students[6]!, args.students[7]!, args.students[9]!];
  const day = (offset: number) => localDate(new Date(now.getTime() + offset * DAY_MS), "Asia/Kolkata");
  const [past] = await db
    .insert(peerSessions)
    .values({ tenantId, track: "hr", mode: "in_person", place: "On campus: meet at the library entrance, or agree another spot", startsAt: new Date(now.getTime() - 3 * DAY_MS), aId: a, bId: b, seed: 7, createdAt: new Date(now.getTime() - 4 * DAY_MS) })
    .returning();
  await db.insert(peerFeedback).values([
    { sessionId: past!.id, fromId: a, toId: b, ratings: { clarity: 4, content: 3, confidence: 3 }, comment: "Good examples. Slow down a little on the project question.", createdAt: new Date(now.getTime() - 3 * DAY_MS + 3_600_000) },
    { sessionId: past!.id, fromId: b, toId: a, ratings: { clarity: 3, content: 4, confidence: 4 }, comment: "Strong answer on teamwork; the weakness answer sounded rehearsed.", createdAt: new Date(now.getTime() - 3 * DAY_MS + 7_200_000) },
  ]);
  await db.insert(peerRequests).values({
    tenantId,
    userId: waiting,
    track: "technical",
    mode: "either",
    windows: [
      { date: day(1), slot: "evening" as const },
      { date: day(2), slot: "afternoon" as const },
      { date: day(2), slot: "evening" as const },
    ],
    createdAt: new Date(now.getTime() - 3_600_000),
  });
}

/**
 * Certifications on resumes (some verified, one waiting), and students on duty:
 * two at a hackathon today, one asking for an off-campus interview.
 */
export async function seedCertificationsAndOnDuty(args: { tenantId: string; tpoId: string; students: string[]; now: Date }) {
  const { tenantId, tpoId, now } = args;
  const s = args.students;
  const month = (back: number) => localDate(new Date(now.getTime() - back * 30 * DAY_MS), "Asia/Kolkata").slice(0, 7);
  const cert = (userId: string, title: string, organisation: string, monthsAgo: number, description: string, link: string, verified: boolean, validYears?: number) => ({
    tenantId,
    userId,
    kind: "certification" as const,
    title,
    organisation,
    startMonth: month(monthsAgo),
    endMonth: validYears ? `${Number(month(monthsAgo).slice(0, 4)) + validYears}${month(monthsAgo).slice(4)}` : null,
    description,
    link,
    verification: verified ? ("verified" as const) : ("requested" as const),
    verifiedBy: verified ? tpoId : null,
    verifiedAt: verified ? new Date(now.getTime() - 20 * DAY_MS) : null,
    createdAt: new Date(now.getTime() - 40 * DAY_MS),
    updatedAt: new Date(now.getTime() - (verified ? 30 : 1) * DAY_MS),
  });
  await db.insert(resumeEntries).values([
    cert(s[2]!, "Programming, Data Structures and Algorithms using Python", "NPTEL (IIT Madras)", 6, "Elite, 81%", "https://nptel.ac.in/noc/certificate/NPTEL26CS40S0001", true),
    cert(s[3]!, "Database Management System", "NPTEL (IIT Kharagpur)", 5, "Elite + Silver, 88%", "https://nptel.ac.in/noc/certificate/NPTEL26CS39S0002", true),
    cert(s[4]!, "Programming in Java", "NPTEL (IIT Kharagpur)", 4, "Elite, 76%", "https://nptel.ac.in/noc/certificate/NPTEL26CS68S0003", true),
    cert(s[5]!, "AWS Certified Cloud Practitioner", "AWS", 2, "Score 812/1000", "https://www.credly.com/badges/0d1e2f3a-demo", true, 3),
    cert(s[8]!, "Introduction to Networks (CCNA 1)", "Cisco Networking Academy", 1, "", "https://www.credly.com/badges/4b5c6d7e-demo", false),
  ]);
  const today = localDate(now, "Asia/Kolkata");
  const tomorrow = localDate(new Date(now.getTime() + DAY_MS), "Asia/Kolkata");
  const hackathon = "Smart India Hackathon grand finale (team CodeCrafters)";
  await db.insert(onDutyRequests).values([
    ...[s[2]!, s[3]!].flatMap((userId) =>
      [today, tomorrow].map((date) => ({ tenantId, userId, date, part: "full" as const, reason: "other" as const, purpose: hackathon, detail: "KIET, Ghaziabad", status: "approved" as const, decidedBy: tpoId, decidedAt: new Date(now.getTime() - 3 * DAY_MS), createdAt: new Date(now.getTime() - 4 * DAY_MS) })),
    ),
    { tenantId, userId: s[4]!, date: tomorrow, part: "forenoon" as const, reason: "other" as const, purpose: "Accenture off-campus interview", detail: "Their Bengaluru office, 9:30 am", status: "pending" as const, createdAt: new Date(now.getTime() - 2 * 3_600_000) },
  ]);
}
