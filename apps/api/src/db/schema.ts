import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Answer, BenchmarkValues, GdSpeaker, GdParticipation, TrainingKind, OutcomeKind, GuardianRelation, PlacementPolicy, Panel, DocumentType, HelpCategory, RecordField, ResumeEntryKind, InterviewFeedbackDimension, CompanyStage, InteractionKind, LiveStatus, PlanDay, Verdict, CodeLanguage, CompanyType, Delivery, DisplayPrefs, Division, PlacementCriteria, QuestionBody, QuestionType, Role, StudentResponse } from "@playcode/core";

// Every tenant-owned table carries tenant_id. Rows with tenant_id = null in
// content tables (skills, questions, packs) are global PlayCode content.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").$type<"institution" | "partner" | "company">().notNull().default("institution"),
  parentId: uuid("parent_id"),
  plan: text("plan").$type<"starter" | "pro" | "enterprise">().notNull().default("pro"),
  seats: integer("seats").notNull().default(500),
  validUntil: text("valid_until"),
  timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
  settings: jsonb("settings").$type<TenantSettings>().notNull().default({}),
  /** White-label: shown on the sign-in page, app header and certificates. Sub-tenants inherit their partner's. */
  branding: jsonb("branding").$type<TenantBranding>().notNull().default({}),
  createdAt: createdAt(),
});

export interface TenantSettings {
  weekendsOptional?: boolean;
  /** Staff must set up two-factor sign-in before using the console. */
  requireStaffMfa?: boolean;
  nudges?: boolean;
  /** AI coach hints in practice (on by default when AI is configured). */
  aiHints?: boolean;
  /** AI review of webcam snapshots in strict tests (on by default when AI is configured). */
  aiProctoring?: boolean;
  /** Days after a test closes before its webcam snapshots are deleted (default 90). */
  snapshotRetentionDays?: number;
  /** Students may join the talent pool, where companies on PlayCode can find and invite them. */
  talentPool?: boolean;
  /** Students may have a monthly progress email sent to a parent or guardian. */
  guardianReports?: boolean;
  /** Offer tiers, the most offers a student may hold, and the time to accept one. */
  placementPolicy?: Partial<PlacementPolicy>;
  /** What the placement brochure says about the institution, and whom recruiters should contact. */
  brochure?: { about?: string; contactName?: string; contactRole?: string; contactEmail?: string; contactPhone?: string };
}

export interface TenantBranding {
  appName?: string;
  primaryColor?: string; // #rrggbb
  logoKey?: string;
  logoType?: string;
  certificateSignatory?: string;
}

export const orgUnits = pgTable(
  "org_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    kind: text("kind").$type<"department" | "batch" | "section">().notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("org_units_tenant_idx").on(t.tenantId)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    rollNo: text("roll_no"),
    /** E.164 phone number for WhatsApp nudges (optional). */
    phone: text("phone"),
    notifyPrefs: jsonb("notify_prefs").$type<{ whatsapp?: boolean; push?: boolean }>().notNull().default({}),
    /** Interface language: "en" or "hi". */
    locale: text("locale").$type<"en" | "hi">().notNull().default("en"),
    /** Text size, font, motion and contrast (packages/core display.ts). */
    displayPrefs: jsonb("display_prefs").$type<DisplayPrefs>().notNull().default({}),
    /** SHA-256 of the private calendar feed token; the token itself is shown once. */
    calendarTokenHash: text("calendar_token_hash").unique(),
    calendarTokenCreatedAt: timestamp("calendar_token_created_at", { withTimezone: true }),
    status: text("status").$type<"active" | "disabled" | "erased">().notNull().default("active"),
    /** Two-factor sign-in (TOTP): the active secret, a secret being set up, and the last time step used (no replays). */
    totpSecretEnc: text("totp_secret_enc"),
    totpPendingEnc: text("totp_pending_enc"),
    totpLastStep: integer("totp_last_step"),
    /** SHA-256 hashes of unused recovery codes. */
    recoveryCodes: jsonb("recovery_codes").$type<string[]>().notNull().default([]),
    /** The identity provider's id for this person, when provisioned by SCIM. */
    scimExternalId: text("scim_external_id"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("users_tenant_idx").on(t.tenantId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** null = role applies to the whole tenant. */
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("memberships_user_idx").on(t.userId), index("memberships_unit_idx").on(t.orgUnitId)],
);

export const skills = pgTable("skills", {
  id: text("id").primaryKey(), // "loops.nested"
  topic: text("topic").notNull(), // "loops"
  topicName: text("topic_name").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
});

export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").$type<QuestionType>().notNull(),
    skillId: text("skill_id").notNull().references(() => skills.id),
    language: text("language").notNull(),
    difficulty: integer("difficulty").$type<1 | 2 | 3>().notNull(),
    body: jsonb("body").$type<QuestionBody>().notNull(),
    answer: jsonb("answer").$type<Answer>().notNull(),
    explanation: text("explanation").notNull(),
    hints: jsonb("hints").$type<string[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    status: text("status").$type<"draft" | "live" | "retired">().notNull().default("live"),
    rating: integer("rating").notNull(),
    attempts: integer("attempts").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    version: integer("version").notNull().default(1),
    /** Where it came from: the bundled bank, the content studio, or an AI draft accepted in the studio. */
    origin: text("origin").$type<"seed" | "studio" | "ai">().notNull().default("seed"),
    /** Write code: a reference solution per language, run against every test when checking. Never sent to students. */
    solutions: jsonb("solutions").$type<Partial<Record<CodeLanguage, string>>>(),
    /** "run": the studio runs the code and compares its output with the answer. "manual": an author vouches for it. */
    checkMode: text("check_mode").$type<"run" | "manual">().notNull().default("manual"),
    lastCheck: jsonb("last_check").$type<QuestionCheck>(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("questions_skill_idx").on(t.skillId), index("questions_tenant_status_idx").on(t.tenantId, t.status)],
);

export interface QuestionCheck {
  ok: boolean;
  problems: string[];
  /** What running the code printed, for output questions. */
  output?: string;
  at: string;
}

export const packs = pgTable("packs", {
  id: text("id").primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"mission" | "set">().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  questionIds: jsonb("question_ids").$type<string[]>().notNull(),
  passMark: integer("pass_mark").notNull().default(60), // percent
  profile: text("profile"), // readiness profile the mission maps to
  position: integer("position").notNull().default(0),
});

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    packId: text("pack_id").references(() => packs.id),
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
    orgUnitIds: jsonb("org_unit_ids").$type<string[]>().notNull(),
    /** Only these students of the units (a remedial assignment); null means everyone in them. */
    studentIds: jsonb("student_ids").$type<string[]>(),
    /** A remedial assignment's skills, its mastery threshold, and each student's mastery of those skills when it was set. */
    remedial: jsonb("remedial").$type<{ skillIds: string[]; below: number; baseline: Record<string, number> }>(),
    openAt: timestamp("open_at", { withTimezone: true }).notNull(),
    closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("assignments_tenant_idx").on(t.tenantId)],
);

/** "offline": a pack downloaded to answer without a connection, marked when it syncs. */
export type SessionKind = "skill" | "daily" | "pack" | "assignment" | "mistakes" | "review" | "offline";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SessionKind>().notNull(),
    skillId: text("skill_id"),
    packId: text("pack_id"),
    assignmentId: uuid("assignment_id"),
    day: text("day"), // daily challenge date
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
    currentIndex: integer("current_index").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    xpEarned: integer("xp_earned").notNull().default(0),
    usesHearts: boolean("uses_hearts").notNull().default(false),
    hintsUsed: jsonb("hints_used").$type<Record<string, number>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_assignment_idx").on(t.assignmentId)],
);

export const responses = pgTable(
  "responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull().references(() => questions.id),
    questionVersion: integer("question_version").notNull(),
    response: jsonb("response").$type<StudentResponse>().notNull(),
    correct: boolean("correct").notNull(),
    xp: integer("xp").notNull(),
    timeMs: integer("time_ms").notNull(),
    hintsUsed: integer("hints_used").notNull().default(0),
    /** Code and SQL: test results summary from the execution service. */
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("responses_session_question_uq").on(t.sessionId, t.questionId),
    index("responses_user_idx").on(t.userId, t.questionId),
    index("responses_tenant_time_idx").on(t.tenantId, t.createdAt),
  ],
);

export const playerProfiles = pgTable("player_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  xp: integer("xp").notNull().default(0),
  streakCurrent: integer("streak_current").notNull().default(0),
  streakLongest: integer("streak_longest").notNull().default(0),
  streakLastDate: text("streak_last_date"),
  freezesLeft: integer("freezes_left").notNull().default(2),
  freezesMonth: text("freezes_month"),
  hearts: integer("hearts").notNull().default(5),
  heartsUpdatedAt: timestamp("hearts_updated_at", { withTimezone: true }).notNull().defaultNow(),
  division: text("division").$type<Division>().notNull().default("bronze"),
  repeatXpDay: text("repeat_xp_day"),
  repeatXpToday: integer("repeat_xp_today").notNull().default(0),
  duelRating: integer("duel_rating").notNull().default(1000),
  duelWins: integer("duel_wins").notNull().default(0),
  duelLosses: integer("duel_losses").notNull().default(0),
  duelDraws: integer("duel_draws").notNull().default(0),
  /** Coding contest rating (multi-player Elo) and how many rated contests it rests on. */
  contestRating: integer("contest_rating").notNull().default(1200),
  contestsRated: integer("contests_rated").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skillRatings = pgTable(
  "skill_ratings",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull().references(() => skills.id),
    rating: integer("rating").notNull(),
    attempts: integer("attempts").notNull().default(0),
    correct: integer("correct").notNull().default(0),
    lastPractisedAt: text("last_practised_at"),
    /** Spaced review: step on the interval ladder and the next due date (YYYY-MM-DD). */
    reviewStep: integer("review_step").notNull().default(0),
    reviewDueOn: text("review_due_on"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skillId] })],
);

export const mistakes = pgTable(
  "mistakes",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull().references(() => questions.id),
    wrongCount: integer("wrong_count").notNull().default(1),
    lastWrongAt: timestamp("last_wrong_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questionId] })],
);

export const leagueMembers = pgTable(
  "league_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    weekKey: text("week_key").notNull(),
    division: text("division").$type<Division>().notNull(),
    groupNo: integer("group_no").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weeklyXp: integer("weekly_xp").notNull().default(0),
    result: text("result").$type<"promoted" | "demoted" | "stayed">(),
    finalRank: integer("final_rank"),
  },
  (t) => [
    uniqueIndex("league_members_user_week_uq").on(t.userId, t.weekKey),
    index("league_members_group_idx").on(t.tenantId, t.weekKey, t.division, t.groupNo),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id"),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    target: text("target"),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_tenant_idx").on(t.tenantId, t.createdAt)],
);

export type DuelStatus = "waiting" | "active" | "finished" | "expired" | "declined" | "cancelled";

export const duels = pgTable(
  "duels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    status: text("status").$type<DuelStatus>().notNull().default("waiting"),
    challengerId: uuid("challenger_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Set for a direct challenge; null while an open duel waits for a match. */
    opponentId: uuid("opponent_id").references(() => users.id, { onDelete: "cascade" }),
    questionIds: jsonb("question_ids").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    winnerId: uuid("winner_id"),
  },
  (t) => [index("duels_tenant_status_idx").on(t.tenantId, t.status), index("duels_opponent_idx").on(t.opponentId)],
);

export const duelPlayers = pgTable(
  "duel_players",
  {
    duelId: uuid("duel_id").notNull().references(() => duels.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<{ questionId: string; correct: boolean; timeMs: number }[]>().notNull().default([]),
    correct: integer("correct").notNull().default(0),
    timeMs: integer("time_ms").notNull().default(0),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome").$type<"win" | "loss" | "draw">(),
    ratingBefore: integer("rating_before").notNull(),
    ratingAfter: integer("rating_after"),
    xp: integer("xp").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.duelId, t.userId] }), index("duel_players_user_idx").on(t.userId)],
);

// ---------- Proctored assessments ----------

export interface AssessmentSection {
  title: string;
  /** Pool to draw from; each student gets `pick` of these, in a shuffled order. */
  questionIds: string[];
  pick: number;
  marks: number;
  negative: number;
}

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    proctorLevel: integer("proctor_level").$type<1 | 2 | 3>().notNull().default(1),
    durationMinutes: integer("duration_minutes").notNull(),
    openAt: timestamp("open_at", { withTimezone: true }).notNull(),
    closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
    sections: jsonb("sections").$type<AssessmentSection[]>().notNull(),
    orgUnitIds: jsonb("org_unit_ids").$type<string[]>().notNull(),
    releasePolicy: text("release_policy").$type<"immediate" | "manual">().notNull().default("manual"),
    resultsReleasedAt: timestamp("results_released_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("assessments_tenant_idx").on(t.tenantId)],
);

export interface AttemptQuestion {
  questionId: string;
  section: number;
}

export interface AttemptResult {
  questionId: string;
  section: number;
  answered: boolean;
  score: number; // 0-1
  correct: boolean;
  detail?: Record<string, unknown>;
}

export type AttemptStatus = "in_progress" | "submitted" | "auto_submitted";

export const assessmentAttempts = pgTable(
  "assessment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    questions: jsonb("questions").$type<AttemptQuestion[]>().notNull(),
    answers: jsonb("answers").$type<Record<string, { response: StudentResponse; savedAt: string }>>().notNull().default({}),
    status: text("status").$type<AttemptStatus>().notNull().default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    deviceId: text("device_id"),
    results: jsonb("results").$type<AttemptResult[]>(),
    score: integer("score_x100"), // score * 100, to keep it exact
    maxScore: integer("max_score_x100"),
    sectionScores: jsonb("section_scores").$type<{ title: string; score: number; max: number; correct: number; wrong: number; skipped: number }[]>(),
    integrity: jsonb("integrity").$type<Record<string, number>>().notNull().default({}),
    maxSimilarity: integer("max_similarity_pct").notNull().default(0),
    riskScore: integer("risk_score").notNull().default(0),
    extraMs: integer("extra_ms").notNull().default(0),
  },
  (t) => [uniqueIndex("attempts_assessment_user_uq").on(t.assessmentId, t.userId), index("attempts_user_idx").on(t.userId)],
);

export const integrityEvents = pgTable(
  "integrity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id").notNull().references(() => assessmentAttempts.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    detail: text("detail"),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [index("integrity_events_attempt_idx").on(t.attemptId, t.at)],
);

export const attemptSnapshots = pgTable(
  "attempt_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id").notNull().references(() => assessmentAttempts.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** Level 3: what the AI review saw. Null until reviewed. */
    review: jsonb("review").$type<{ faces: number; phone: boolean; otherPerson: boolean; note: string } | { error: string }>(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("attempt_snapshots_attempt_idx").on(t.attemptId, t.at)],
);

export const plagiarismPairs = pgTable(
  "plagiarism_pairs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    attemptA: uuid("attempt_a").notNull().references(() => assessmentAttempts.id, { onDelete: "cascade" }),
    attemptB: uuid("attempt_b").notNull().references(() => assessmentAttempts.id, { onDelete: "cascade" }),
    similarityPct: integer("similarity_pct").notNull(),
  },
  (t) => [uniqueIndex("plagiarism_pair_uq").on(t.assessmentId, t.questionId, t.attemptA, t.attemptB)],
);

// ---------- Events ----------

export const competitions = pgTable(
  "competitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null for platform-run inter-college events. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    scope: text("scope").$type<"sections" | "colleges">().notNull(),
    /** Org unit ids (sections scope) or tenant ids (colleges scope). */
    teamIds: jsonb("team_ids").$type<string[]>().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("competitions_tenant_idx").on(t.tenantId)],
);

// ---------- Code execution queue ----------

/** A program run waiting for, or done by, an execution worker (EXECUTION_MODE=queue). Deleted a day after it finishes. */
export const executionJobs = pgTable(
  "execution_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 0 tests and contests, 1 duels, 2 practice: lower runs first. */
    priority: integer("priority").notNull(),
    language: text("language").$type<CodeLanguage>().notNull(),
    source: text("source").notNull(),
    inputs: jsonb("inputs").$type<string[]>().notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    workerId: text("worker_id"),
    result: jsonb("result").$type<{ status: string; stdout: string; stderr: string; timeMs: number }[]>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("execution_jobs_queue_idx").on(t.status, t.priority, t.createdAt)],
);

// ---------- Live classroom quizzes ----------

/** A quiz a teacher runs live in class: one question at a time, students answer on their phones. */
export const liveQuizzes = pgTable(
  "live_quizzes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    hostId: uuid("host_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Six digits students type to join; unique among quizzes that haven't ended. */
    code: text("code").notNull(),
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
    secondsPerQuestion: integer("seconds_per_question").notNull(),
    status: text("status").$type<LiveStatus>().notNull().default("lobby"),
    currentIndex: integer("current_index").notNull().default(-1),
    questionStartedAt: timestamp("question_started_at", { withTimezone: true }),
    createdAt: createdAt(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("live_quizzes_code_idx").on(t.code), index("live_quizzes_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const liveQuizPlayers = pgTable(
  "live_quiz_players",
  {
    quizId: uuid("quiz_id").notNull().references(() => liveQuizzes.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(0),
    lastScoredAt: timestamp("last_scored_at", { withTimezone: true }),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.quizId, t.userId] })],
);

export const liveQuizAnswers = pgTable(
  "live_quiz_answers",
  {
    quizId: uuid("quiz_id").notNull().references(() => liveQuizzes.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    questionIndex: integer("question_index").notNull(),
    response: jsonb("response").$type<StudentResponse>().notNull(),
    correct: boolean("correct").notNull(),
    points: integer("points").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.quizId, t.userId, t.questionIndex] })],
);

// ---------- Weekly insights ----------

export interface InsightReport {
  headline: string;
  points: { text: string; tone: "good" | "watch" | "act" }[];
  actions: string[];
}

/** An AI-written weekly briefing for staff, generated at most once a day per scope (whole institution, a unit, or one person's units). */
export const insightReports = pgTable(
  "insight_reports",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    scopeKey: text("scope_key").notNull(),
    day: text("day").notNull(),
    report: jsonb("report").$type<InsightReport>().notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.scopeKey, t.day] })],
);

// ---------- Study plans ----------

/** A student's day-by-day plan to a target (a placement drive or a date). One per student; rebuilding replaces it. */
export const studyPlans = pgTable("study_plans", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  /** What the plan works towards. */
  target: jsonb("target").$type<{ label: string; date: string; profile: "service" | "product"; driveId: string | null }>().notNull(),
  days: jsonb("days").$type<PlanDay[]>().notNull(),
  createdAt: createdAt(),
});

// ---------- Coding contests ----------

/** A timed, ICPC-style coding contest, run by a college (tenantId) or by PlayCode across colleges (tenantId null). */
export const contests = pgTable(
  "contests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Coding and SQL questions, in the order shown (A, B, C...). */
    problemIds: jsonb("problem_ids").$type<string[]>().notNull(),
    /** College contest: org units taking part (empty = every student). PlayCode contest: the colleges taking part. */
    audienceIds: jsonb("audience_ids").$type<string[]>().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** The public scoreboard freezes this many minutes before the end. */
    freezeMinutes: integer("freeze_minutes").notNull().default(0),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    /** Set once results, ratings and certificates are out. */
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (t) => [index("contests_tenant_idx").on(t.tenantId, t.startsAt)],
);

/** Each participant's final place and rating change in a finished contest. */
/** Feedback from a human mock interview, on the PANEL_RUBRIC in packages/core. */
export interface PanelFeedback {
  scores: Record<string, number>;
  overall: number;
  recommendation: "ready" | "almost" | "not_yet";
  strengths: string;
  improvements: string;
  by: string;
}

/** A slot for a mock interview with a real interviewer (faculty or alumni), bookable by one student. */
export const interviewSlots = pgTable(
  "interview_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Alumni often have no account, so the interviewer is a name; the creator records feedback for them. */
    interviewerName: text("interviewer_name").notNull(),
    kind: text("kind").$type<"technical" | "hr" | "general">().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    /** A room or a meeting link. */
    location: text("location").notNull().default(""),
    /** Batches or sections whose students may book; empty for everyone. */
    unitIds: jsonb("unit_ids").$type<string[]>().notNull().default([]),
    status: text("status").$type<"open" | "booked" | "cancelled" | "done" | "no_show">().notNull().default("open"),
    bookedBy: uuid("booked_by").references(() => users.id, { onDelete: "set null" }),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    feedback: jsonb("feedback").$type<PanelFeedback>(),
    feedbackAt: timestamp("feedback_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("interview_slots_tenant_idx").on(t.tenantId, t.startsAt), index("interview_slots_booked_idx").on(t.bookedBy)],
);

/** An AI review of an accepted coding answer: one per response, kept so it is never paid for twice. */
export const codeReviews = pgTable("code_reviews", {
  responseId: uuid("response_id").primaryKey().references(() => responses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  review: jsonb("review").$type<{ summary: string; timeComplexity: string; spaceComplexity: string; betterApproach: string | null; edgeCases: string[]; readability: string[]; improvedCode: string }>().notNull(),
  createdAt: createdAt(),
}, (t) => [index("code_reviews_user_idx").on(t.userId, t.createdAt)]);

/** A student's question to their teachers about a question they answered. */
export const doubts = pgTable(
  "doubts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    status: text("status").$type<"open" | "answered" | "closed">().notNull().default("open"),
    answer: text("answer"),
    /** Shown, without names, to other students of the institution after they answer the question. */
    shared: boolean("shared").notNull().default(false),
    answeredBy: uuid("answered_by").references(() => users.id, { onDelete: "set null" }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("doubts_tenant_status_idx").on(t.tenantId, t.status, t.createdAt), index("doubts_question_idx").on(t.questionId, t.tenantId)],
);

/** A study squad: a few classmates with a shared weekly goal of answers. */
export const squads = pgTable(
  "squads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** What classmates type to join. */
    code: text("code").notNull().unique(),
    weeklyGoal: integer("weekly_goal").notNull().default(100),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("squads_tenant_idx").on(t.tenantId)],
);

/** One squad per student. */
export const squadMembers = pgTable("squad_members", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  squadId: uuid("squad_id").notNull().references(() => squads.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
}, (t) => [index("squad_members_squad_idx").on(t.squadId)]);

/** A self-serve mock test on a company pattern (packages/core mock-test.ts): sections in order, each timed. */
export const mockAttempts = pgTable(
  "mock_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    pattern: text("pattern").$type<"service" | "product">().notNull(),
    questions: jsonb("questions").$type<AttemptQuestion[]>().notNull(),
    answers: jsonb("answers").$type<Record<string, { response: StudentResponse; savedAt: string }>>().notNull().default({}),
    status: text("status").$type<"in_progress" | "submitted">().notNull().default("in_progress"),
    /** The open section, and when it closes. */
    section: integer("section").notNull().default(0),
    sectionDeadline: timestamp("section_deadline", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    results: jsonb("results").$type<AttemptResult[]>(),
    score: integer("score_x100"),
    maxScore: integer("max_score_x100"),
    sectionScores: jsonb("section_scores").$type<{ title: string; score: number; max: number; correct: number; wrong: number; skipped: number }[]>(),
  },
  (t) => [index("mock_attempts_user_idx").on(t.userId, t.startedAt), index("mock_attempts_pattern_idx").on(t.pattern, t.status)],
);

export const contestResults = pgTable(
  "contest_results",
  {
    contestId: uuid("contest_id").notNull().references(() => contests.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    participants: integer("participants").notNull(),
    solved: integer("solved").notNull(),
    penalty: integer("penalty").notNull(),
    ratingBefore: integer("rating_before").notNull(),
    ratingAfter: integer("rating_after").notNull(),
    certificateCode: text("certificate_code"),
  },
  (t) => [primaryKey({ columns: [t.contestId, t.userId] }), index("contest_results_user_idx").on(t.userId)],
);

export const contestSubmissions = pgTable(
  "contest_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contestId: uuid("contest_id").notNull().references(() => contests.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull().references(() => questions.id),
    response: jsonb("response").$type<StudentResponse>().notNull(),
    verdict: text("verdict").$type<Verdict>().notNull(),
    passed: integer("passed").notNull().default(0),
    total: integer("total").notNull().default(0),
    /** Made after the contest ended, for practice: judged the same, kept off the scoreboard and ratings. */
    upsolve: boolean("upsolve").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("contest_submissions_contest_idx").on(t.contestId, t.createdAt), index("contest_submissions_user_idx").on(t.userId, t.contestId)],
);

// ---------- Notifications ----------

export type NotificationTemplate = "streak_at_risk" | "assignment_due" | "test_open" | "duel_invite" | "announcement" | "placement" | "review_due" | "talent_invite" | "contest" | "squad" | "doubt" | "interview_slot" | "class_test" | "training" | "circular";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    template: text("template").$type<NotificationTemplate>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    /** In-app is always delivered; external delivery goes through `channel`. */
    channel: text("channel").$type<"whatsapp" | "none">().notNull().default("none"),
    status: text("status").$type<"pending" | "sent" | "failed" | "skipped">().notNull().default("pending"),
    error: text("error"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    sentBy: uuid("sent_by"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** When it went out as a web push notification (null: not pushed). */
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt), index("notifications_status_idx").on(t.status)],
);

// ---------- Certificates ----------

export const certificates = pgTable(
  "certificates",
  {
    /** Short public code printed on the certificate and used in the verification link. */
    code: text("code").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"mission" | "path" | "contest">().notNull(),
    refId: text("ref_id").notNull(),
    title: text("title").notNull(),
    scorePct: integer("score_pct").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("certificates_user_ref_uq").on(t.userId, t.kind, t.refId)],
);

// ---------- Public API and webhooks ----------

export const API_SCOPES = ["users:read", "users:write", "assignments:read", "assignments:write", "results:read", "reports:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const apiClients = pgTable(
  "api_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    clientId: text("client_id").notNull().unique(),
    /** SHA-256 of the secret; the secret itself is shown once at creation. */
    secretHash: text("secret_hash").notNull(),
    scopes: jsonb("scopes").$type<ApiScope[]>().notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_clients_tenant_idx").on(t.tenantId)],
);

export const WEBHOOK_EVENTS = [
  "assignment.completed",
  "assessment.submitted",
  "assessment.results_released",
  "certificate.issued",
  "user.created",
  "candidate.registered",
  "candidate.status_changed",
  "user.erased",
  "path.completed",
  "placement.offered",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Signing secret, encrypted at rest (lib/crypto). */
    secretEnc: text("secret_enc").notNull(),
    events: jsonb("events").$type<WebhookEvent[]>().notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("webhooks_tenant_idx").on(t.tenantId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"pending" | "delivered" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt), index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt)],
);

// ---------- Hiring drives ----------

export const drives = pgTable(
  "drives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    roleTitle: text("role_title").notNull(),
    description: text("description").notNull().default(""),
    /** Candidates join this org unit, which the drive's assessment targets. */
    orgUnitId: uuid("org_unit_id").notNull().references(() => orgUnits.id),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
    /** Public apply link code. */
    inviteCode: text("invite_code").notNull().unique(),
    status: text("status").$type<"open" | "closed">().notNull().default("open"),
    cutoffPct: integer("cutoff_pct"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("drives_tenant_idx").on(t.tenantId)],
);

export type CandidateStatus = "applied" | "shortlisted" | "rejected" | "hired";

export const driveCandidates = pgTable(
  "drive_candidates",
  {
    driveId: uuid("drive_id").notNull().references(() => drives.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    source: text("source").$type<"link" | "imported">().notNull(),
    status: text("status").$type<CandidateStatus>().notNull().default("applied"),
    college: text("college"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.driveId, t.userId] })],
);

// ---------- Single sign-on ----------

export const ssoConnections = pgTable("sso_connections", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"google" | "microsoft" | "oidc">().notNull(),
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(),
  /** Only emails on these domains may sign in through this connection. */
  emailDomains: jsonb("email_domains").$type<string[]>().notNull(),
  /** Create a student account on first sign-in, in this unit. */
  autoProvisionUnitId: uuid("auto_provision_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});

// ---------- Privacy ----------

export const CONSENT_PURPOSES = ["privacy_notice", "whatsapp", "public_profile", "talent_pool", "guardian_reports"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Append-only ledger: every grant and withdrawal, with the notice version shown at the time. */
export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<ConsentPurpose>().notNull(),
    granted: boolean("granted").notNull(),
    noticeVersion: text("notice_version").notNull(),
    source: text("source").$type<"app" | "drive_apply" | "settings">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("consents_user_idx").on(t.userId, t.purpose, t.createdAt)],
);

export type ErasureStatus = "pending" | "completed" | "rejected" | "cancelled";

export const erasureRequests = pgTable(
  "erasure_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** Kept after erasure: the user row survives, anonymised, so this stays as the record. */
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    status: text("status").$type<ErasureStatus>().notNull().default("pending"),
    resolution: text("resolution"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("erasure_requests_tenant_idx").on(t.tenantId, t.status, t.createdAt)],
);

// ---------- AI ----------

export type AiFeature = "coach_hint" | "question_draft" | "snapshot_review" | "mock_interview" | "weekly_insights" | "code_review" | "group_discussion" | "writing_feedback";

/** Token use per call, for cost reporting per institution. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    feature: text("feature").$type<AiFeature>().notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_tenant_idx").on(t.tenantId, t.createdAt)],
);

/** Every coach hint shown, for daily limits and for teachers to see where students get stuck. */
export const coachHints = pgTable(
  "coach_hints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    level: integer("level").notNull(),
    hint: text("hint").notNull(),
    /** Served from the shared cache (no student code involved). */
    cached: boolean("cached").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("coach_hints_user_idx").on(t.userId, t.createdAt), index("coach_hints_question_idx").on(t.questionId)],
);

/** Generic (not student-specific) coach hints, reused across students. */
export const coachHintCache = pgTable(
  "coach_hint_cache",
  {
    questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    level: integer("level").notNull(),
    hint: text("hint").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.version, t.level] })],
);

// ---------- LTI 1.3 ----------

/** An LMS (Moodle, Canvas, Blackboard...) registered to launch PlayCode for an institution. */
export const ltiPlatforms = pgTable(
  "lti_platforms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    issuer: text("issuer").notNull(),
    clientId: text("client_id").notNull(),
    /** Deployments allowed to launch; empty means any deployment of this client. */
    deploymentIds: jsonb("deployment_ids").$type<string[]>().notNull().default([]),
    authLoginUrl: text("auth_login_url").notNull(),
    authTokenUrl: text("auth_token_url").notNull(),
    jwksUrl: text("jwks_url").notNull(),
    /** Learners launching for the first time get a student account in this unit. */
    autoProvisionUnitId: uuid("auto_provision_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lti_platforms_issuer_client_uq").on(t.issuer, t.clientId)],
);

/** PlayCode's own signing keys (for grade passback client assertions), published at /lti/jwks. */
export const ltiKeys = pgTable("lti_keys", {
  kid: text("kid").primaryKey(),
  publicJwk: jsonb("public_jwk").$type<Record<string, unknown>>().notNull(),
  privateKeyEnc: text("private_key_enc").notNull(),
  createdAt: createdAt(),
});

/** Which PlayCode user an LMS user (platform + sub) is. */
export const ltiAccounts = pgTable(
  "lti_accounts",
  {
    platformId: uuid("platform_id").notNull().references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    sub: text("sub").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.platformId, t.sub] }), index("lti_accounts_user_idx").on(t.userId)],
);

/** An activity placed in an LMS course, bound to a PlayCode assignment. */
export const ltiLinks = pgTable(
  "lti_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platformId: uuid("platform_id").notNull().references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    resourceLinkId: text("resource_link_id").notNull(),
    title: text("title"),
    contextTitle: text("context_title"),
    assignmentId: uuid("assignment_id").references(() => assignments.id, { onDelete: "set null" }),
    /** Assignment and Grade Services: where scores go, if the LMS offered it. */
    lineitemUrl: text("lineitem_url"),
    agsScopes: jsonb("ags_scopes").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lti_links_platform_resource_uq").on(t.platformId, t.resourceLinkId)],
);

/** Scores waiting to go back to the LMS gradebook (an outbox with retries). */
export const ltiScores = pgTable(
  "lti_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id").notNull().references(() => ltiLinks.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ltiSub: text("lti_sub").notNull(),
    scoreGiven: integer("score_given").notNull(),
    scoreMaximum: integer("score_maximum").notNull(),
    status: text("status").$type<"pending" | "sent" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("lti_scores_due_idx").on(t.status, t.nextAttemptAt)],
);

/** Nonces already used in a launch, so a captured launch can't be replayed. */
export const ltiNonces = pgTable("lti_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------- Learning paths ----------

/** One step of a path: reach a mastery level on a skill, or pass a mission pack. */
export interface PathStep {
  id: string;
  kind: "skill" | "pack";
  /** Skill id or pack id. */
  ref: string;
  title: string;
  /** Skill: mastery % to reach. Pack: score % to pass. */
  target: number;
  /** Due this many days after the path starts (null: no deadline). */
  dueDays: number | null;
}

/**
 * A sequence of skills and missions for a group: a placement-prep track for a
 * college batch, or an onboarding/upskilling track for a company team.
 */
export const learningPaths = pgTable(
  "learning_paths",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    orgUnitIds: jsonb("org_unit_ids").$type<string[]>().notNull(),
    steps: jsonb("steps").$type<PathStep[]>().notNull(),
    /** Steps unlock one after another; otherwise learners take them in any order. */
    sequential: boolean("sequential").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"active" | "archived">().notNull().default("active"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("learning_paths_tenant_idx").on(t.tenantId, t.status)],
);

// ---------- Scheduled reports ----------

/** A staff member's weekly PDF report by email, for their whole scope or one unit. */
export const reportSubscriptions = pgTable(
  "report_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => orgUnits.id, { onDelete: "cascade" }),
    /** 0 = Sunday ... 6 = Saturday, in the institution's time zone. */
    weekday: integer("weekday").notNull().default(1),
    /** Local hour to send at (0-23). */
    hour: integer("hour").notNull().default(8),
    enabled: boolean("enabled").notNull().default(true),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("report_subscriptions_user_uq").on(t.userId, t.tenantId)],
);

// ---------- SAML 2.0 single sign-on ----------

/** An institution's SAML identity provider (ADFS, Okta, Shibboleth, Google Workspace SAML, ...). */
export const samlConnections = pgTable("saml_connections", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  idpEntityId: text("idp_entity_id").notNull(),
  /** HTTP-Redirect single sign-on URL. */
  ssoUrl: text("sso_url").notNull(),
  /** HTTP-Redirect single logout URL; signing out of PlayCode also ends the IdP session when set. */
  sloUrl: text("slo_url"),
  /** Refuse responses whose assertion isn't encrypted to PlayCode's key. */
  requireEncryption: boolean("require_encryption").notNull().default(false),
  /** IdP signing certificates (base64 DER bodies); several are allowed during a rollover. */
  certificates: jsonb("certificates").$type<string[]>().notNull(),
  /** Attribute holding the email; when unset, the NameID (email format) is used. */
  emailAttribute: text("email_attribute"),
  emailDomains: jsonb("email_domains").$type<string[]>().notNull(),
  autoProvisionUnitId: uuid("auto_provision_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});

/** Directory sync: an institution's identity provider (Okta, Entra ID) creating and updating accounts over SCIM 2.0. */
export const scimConnections = pgTable("scim_connections", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** SHA-256 of the bearer token; the token is shown once. */
  tokenHash: text("token_hash").notNull().unique(),
  /** New accounts join this unit until a group puts them elsewhere. */
  defaultUnitId: uuid("default_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

/** Outstanding AuthnRequest ids, so each response must answer a request we sent (shared by all API instances). */
export const samlRequests = pgTable("saml_requests", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  createdAt: createdAt(),
});

/** A teacher choosing PlayCode content from inside the LMS (LTI deep linking), waiting for their pick. */
export const ltiDeepLinks = pgTable("lti_deep_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  platformId: uuid("platform_id").notNull().references(() => ltiPlatforms.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull(),
  returnUrl: text("return_url").notNull(),
  /** Opaque value the LMS asked us to send back. */
  data: text("data"),
  acceptMultiple: boolean("accept_multiple").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Shared state for running several API instances ----------

/** Request counters per key and fixed window, shared by all API instances. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limits_window_idx").on(t.windowStart)],
);

// ---------- Billing ----------

/** Who an institution's invoices are made out to (GST details). */
export const billingProfiles = pgTable("billing_profiles", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  legalName: text("legal_name").notNull(),
  gstin: text("gstin"),
  address: text("address").notNull(),
  /** GST state code, e.g. "29" for Karnataka; decides CGST+SGST or IGST. */
  stateCode: text("state_code"),
  email: text("email").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface InvoiceLine {
  description: string;
  /** SAC code for the service (998431: online software services). */
  sac: string;
  quantity: number;
  unitPricePaise: number;
  amountPaise: number;
}

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** e.g. PC/2026-27/0007, sequential within the Indian financial year. */
    number: text("number").notNull().unique(),
    /** Billing month, "2026-10". */
    period: text("period").notNull(),
    plan: text("plan").$type<"starter" | "pro" | "enterprise">().notNull(),
    lines: jsonb("lines").$type<InvoiceLine[]>().notNull(),
    subtotalPaise: integer("subtotal_paise").notNull(),
    cgstPaise: integer("cgst_paise").notNull(),
    sgstPaise: integer("sgst_paise").notNull(),
    igstPaise: integer("igst_paise").notNull(),
    totalPaise: integer("total_paise").notNull(),
    /** The customer's details as they were when the invoice was issued. */
    billTo: jsonb("bill_to").$type<{ legalName: string; gstin: string | null; address: string; stateCode: string | null; email: string }>().notNull(),
    status: text("status").$type<"issued" | "paid" | "void">().notNull().default("issued"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Online payment (Razorpay payment link), or "manual" when marked paid by PlayCode staff. */
    paidVia: text("paid_via").$type<"razorpay" | "manual">(),
    paymentRef: text("payment_ref"),
    paymentLinkId: text("payment_link_id"),
    paymentLinkUrl: text("payment_link_url"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoices_tenant_period_uq").on(t.tenantId, t.period), uniqueIndex("invoices_payment_link_uq").on(t.paymentLinkId)],
);

// ---------- Sign-in sessions and one-time codes ----------

/** One signed-in device or browser. Tokens carry its id, so it can be signed out remotely. */
export interface SamlSessionRef {
  tenantId: string;
  nameID: string;
  nameIDFormat: string;
  sessionIndex: string | null;
}

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    method: text("method").$type<"password" | "otp" | "sso" | "saml" | "lti" | "apply">().notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** SAML sign-ins: who the IdP said this was, so single logout can find the session. */
    saml: jsonb("saml").$type<SamlSessionRef>(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId, t.createdAt)],
);

/** Passwordless sign-in codes sent by email or WhatsApp (hashed; single use; few attempts). */
export const loginCodes = pgTable(
  "login_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    channel: text("channel").$type<"email" | "whatsapp">().notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("login_codes_user_idx").on(t.userId, t.createdAt)],
);

// ---------- Campus placements ----------

/** A student's academic record, kept by the placement cell for drive eligibility. */
export const academicRecords = pgTable("academic_records", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  cgpa: doublePrecision("cgpa"),
  backlogs: integer("backlogs"),
  tenthPct: doublePrecision("tenth_pct"),
  twelfthPct: doublePrecision("twelfth_pct"),
  graduationYear: integer("graduation_year"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A company visiting the campus to recruit. */
export const placementDrives = pgTable(
  "placement_drives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    companyType: text("company_type").$type<CompanyType>().notNull(),
    roleTitle: text("role_title").notNull(),
    description: text("description").notNull().default(""),
    /** Annual CTC in rupees. */
    ctcRupees: integer("ctc_rupees").notNull(),
    location: text("location").notNull().default(""),
    /** Day of the drive, "2026-11-20". */
    driveDate: text("drive_date").notNull(),
    registerBy: timestamp("register_by", { withTimezone: true }).notNull(),
    criteria: jsonb("criteria").$type<PlacementCriteria>().notNull(),
    /** Selection rounds in order, e.g. online test, technical interview, HR. */
    rounds: jsonb("rounds").$type<string[]>().notNull(),
    /** Mission pack students can practise to prepare. */
    packId: text("pack_id"),
    status: text("status").$type<"open" | "closed" | "completed">().notNull().default("open"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("placement_drives_tenant_idx").on(t.tenantId, t.driveDate)],
);

export type ApplicationStatus = "registered" | "shortlisted" | "rejected" | "offered" | "withdrawn";

export const placementApplications = pgTable(
  "placement_applications",
  {
    driveId: uuid("drive_id").notNull().references(() => placementDrives.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    status: text("status").$type<ApplicationStatus>().notNull().default("registered"),
    /** Selection rounds cleared so far. */
    roundsCleared: integer("rounds_cleared").notNull().default(0),
    offerCtcRupees: integer("offer_ctc_rupees"),
    /** The student's answer to an offer; undecided offers are taken as accepted after `decideBy`. */
    decision: text("decision").$type<"accepted" | "declined">(),
    decideBy: timestamp("decide_by", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Readiness per company profile and practice days in the previous 60, when the student registered: the "before" for outcome reports. */
    readiness: jsonb("readiness").$type<Record<string, number>>().notNull(),
    activeDays60: integer("active_days_60").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.driveId, t.userId] }), index("placement_applications_user_idx").on(t.tenantId, t.userId)],
);

// ---------- AI mock interviews ----------

export interface InterviewTurn {
  role: "interviewer" | "candidate";
  text: string;
  at: string;
  /** A spoken answer: how long the student spoke, and whether they edited the transcript before sending. */
  voice?: { durationMs: number; words: number; wpm: number; fillers: number; edited: boolean };
}

export interface InterviewScorecard {
  /** 1-5 per dimension: problemSolving, fundamentals, communication and code for technical rounds; structure, evidence, communication and selfAwareness for the HR round. */
  scores: Record<string, number>;
  overall: number;
  strengths: string[];
  improvements: string[];
  summary: string;
  /** Skill ids to practise next (technical rounds). */
  practise: string[];
  /** HR round: questions to prepare a better answer for. */
  prepare?: string[];
  /** Spoken interviews: pace and filler words across the spoken answers. */
  delivery?: Delivery | null;
}

export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    track: text("track").$type<"service" | "product" | "hr">().notNull(),
    /** Voice: the interviewer is read aloud and answers are spoken (transcribed in the browser). */
    mode: text("mode").$type<"text" | "voice">().notNull().default("text"),
    /** Skill ids the interview leans on (the student's weakest relevant skills). */
    focusSkills: jsonb("focus_skills").$type<string[]>().notNull(),
    status: text("status").$type<"active" | "finished" | "abandoned">().notNull().default("active"),
    turns: jsonb("turns").$type<InterviewTurn[]>().notNull(),
    scorecard: jsonb("scorecard").$type<InterviewScorecard>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("interviews_user_idx").on(t.userId, t.startedAt), index("interviews_tenant_idx").on(t.tenantId, t.startedAt)],
);

// ---------- Web push ----------

/** A browser or installed app that receives push notifications for a user. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

// ---------- Student profiles ----------

/** What a student adds to their PlayCode record for a resume, and whether recruiters can see it at a public link. */
export const studentProfiles = pgTable("student_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  headline: text("headline").notNull().default(""),
  about: text("about").notNull().default(""),
  links: jsonb("links").$type<{ github?: string; linkedin?: string; portfolio?: string }>().notNull().default({}),
  /** What the student leaves out of their resume and public profile (everything is shown by default). */
  hide: jsonb("hide").$type<{ readiness?: boolean; interview?: boolean; marks?: boolean }>().notNull().default({}),
  /** Public profile at /p/<code>; null while private. */
  publicCode: text("public_code").unique(),
  /** In the talent pool: companies on PlayCode can find this student and invite them. */
  discoverable: boolean("discoverable").notNull().default(false),
  /** What the student is looking for, as filters for companies. Empty: anything. */
  lookingFor: jsonb("looking_for").$type<{ locations?: string[]; companyTypes?: CompanyType[] }>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A nightly snapshot of each institution's aggregate metrics, for anonymised peer benchmarks. */
export const institutionMetrics = pgTable(
  "institution_metrics",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    students: integer("students").notNull(),
    values: jsonb("values").$type<BenchmarkValues>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day] }), index("institution_metrics_day_idx").on(t.day)],
);

export type TalentInviteStatus = "pending" | "accepted" | "declined";

/** A company asking a talent-pool student to apply. Contact details are shared only once the student accepts. */
export const talentInvites = pgTable(
  "talent_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** The student's institution when invited, for the placement cell's view. */
    institutionId: uuid("institution_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    driveId: uuid("drive_id").references(() => drives.id, { onDelete: "set null" }),
    roleTitle: text("role_title").notNull(),
    message: text("message").notNull(),
    status: text("status").$type<TalentInviteStatus>().notNull().default("pending"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [index("talent_invites_user_idx").on(t.userId, t.createdAt), index("talent_invites_company_idx").on(t.companyId, t.createdAt), index("talent_invites_institution_idx").on(t.institutionId, t.createdAt)],
);

// ---------- Billing notices ----------

/** Billing emails already sent (invoice issued, due soon, overdue, licence renewal), so each goes out once. */
export const billingNotices = pgTable(
  "billing_notices",
  {
    key: text("key").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"invoice_issued" | "invoice_due" | "invoice_overdue" | "licence_renewal" | "credit_note">().notNull(),
    recipients: jsonb("recipients").$type<string[]>().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("billing_notices_tenant_idx").on(t.tenantId, t.sentAt)],
);

// ---------- Question quality ----------

export type ReportReason = "wrong_answer" | "unclear" | "typo" | "other";

/** A student's report that a question is wrong or unclear, for the content team to review. */
export const questionReports = pgTable(
  "question_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    questionVersion: integer("question_version").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    reason: text("reason").$type<ReportReason>().notNull(),
    note: text("note").notNull().default(""),
    status: text("status").$type<"open" | "resolved" | "dismissed">().notNull().default("open"),
    resolution: text("resolution"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("question_reports_question_idx").on(t.questionId, t.status)],
);

// ---------- Credit notes ----------

/** A GST credit note reducing an issued invoice, with an optional refund of an online payment. */
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    /** e.g. PC/CN/2026-27/0001, its own series within the financial year. */
    number: text("number").notNull().unique(),
    reason: text("reason").notNull(),
    subtotalPaise: integer("subtotal_paise").notNull(),
    cgstPaise: integer("cgst_paise").notNull(),
    sgstPaise: integer("sgst_paise").notNull(),
    igstPaise: integer("igst_paise").notNull(),
    totalPaise: integer("total_paise").notNull(),
    refundId: text("refund_id"),
    refundStatus: text("refund_status"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => [index("credit_notes_invoice_idx").on(t.invoiceId)],
);

// ---------- Scheduled jobs ----------

/** One run of a scheduled job, for the system status page and alerting. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    status: text("status").$type<"running" | "ok" | "failed">().notNull().default("running"),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("job_runs_job_idx").on(t.job, t.startedAt)],
);

// ---------- Group discussions ----------

export interface GdTurn {
  speaker: GdSpeaker;
  text: string;
  at: string;
  /** The student's closing summary, given when the moderator asks for one. */
  summary?: boolean;
}

export interface GdScorecard {
  /** 1-5 for content, communication, listening, leadership and summary (core GD_DIMENSIONS). */
  scores: Record<string, number>;
  overall: number;
  strengths: string[];
  improvements: string[];
  summary: string;
  /** Arguments the student could have made. */
  missedPoints: string[];
  participation: GdParticipation;
}

/** A practice group discussion: the student with three AI participants and a moderator. */
export const groupDiscussions = pgTable(
  "group_discussions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    topicId: text("topic_id").notNull(),
    status: text("status").$type<"active" | "finished" | "abandoned">().notNull().default("active"),
    /** "summary" once the moderator has asked for a closing summary. */
    phase: text("phase").$type<"discussion" | "summary">().notNull().default("discussion"),
    turns: jsonb("turns").$type<GdTurn[]>().notNull(),
    /** Rounds of discussion so far (each the student speaking or listening, then the others replying). */
    rounds: integer("rounds").notNull().default(0),
    scorecard: jsonb("scorecard").$type<GdScorecard>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("group_discussions_user_idx").on(t.userId, t.startedAt), index("group_discussions_tenant_idx").on(t.tenantId, t.startedAt)],
);

// ---------- Written English ----------

export interface WritingCorrection {
  original: string;
  better: string;
  why: string;
}

export interface WritingFeedback {
  /** 1-5 for task, organisation, language and tone (core WRITING_DIMENSIONS). */
  scores: Record<string, number>;
  overall: number;
  /** The required points the answer covered, by index into the task's points. */
  pointsCovered: number[];
  strengths: string[];
  improvements: string[];
  corrections: WritingCorrection[];
  /** The student's text with the corrections made and nothing else changed. */
  improved: string;
}

/** An email or essay a student wrote against the clock, and the feedback on it. */
export const writingAttempts = pgTable(
  "writing_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    text: text("text").notNull(),
    words: integer("words").notNull(),
    /** Time taken, from opening the task to sending it. */
    timeMs: integer("time_ms").notNull(),
    feedback: jsonb("feedback").$type<WritingFeedback>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("writing_attempts_user_idx").on(t.userId, t.createdAt), index("writing_attempts_tenant_idx").on(t.tenantId, t.createdAt)],
);

// ---------- Question papers ----------

/** A paper for a class test on paper, built from the question bank, with an answer key. */
export const questionPapers = pgTable(
  "question_papers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    durationMinutes: integer("duration_minutes").notNull(),
    marksPerQuestion: integer("marks_per_question").notNull().default(1),
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
    /** 1, or 2 for sets A and B with the questions and options in a different order. */
    sets: integer("sets").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("question_papers_tenant_idx").on(t.tenantId, t.createdAt)],
);

/** A student's marks on a paper test: the answers a teacher entered, marked against the set's key. */
export const paperResults = pgTable(
  "paper_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id").notNull().references(() => questionPapers.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    set: text("set").$type<"A" | "B">().notNull(),
    /** As typed, one character per question in the set's order: an option letter, y or n for written answers, - for blank. */
    answers: text("answers").notNull(),
    /** By question id. */
    outcomes: jsonb("outcomes").$type<Record<string, "right" | "wrong" | "blank">>().notNull(),
    score: integer("score").notNull(),
    enteredBy: uuid("entered_by").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("paper_results_paper_user_idx").on(t.paperId, t.userId), index("paper_results_user_idx").on(t.userId)],
);

// ---------- Training sessions ----------

/** A placement training session (an aptitude class, a soft-skills workshop) for chosen batches, with attendance. */
export const trainingSessions = pgTable(
  "training_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull(),
    title: text("title").notNull(),
    kind: text("kind").$type<TrainingKind>().notNull(),
    trainer: text("trainer").notNull(),
    location: text("location").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    /** Batches or sections it is for; empty means the whole institution. */
    unitIds: jsonb("unit_ids").$type<string[]>().notNull(),
    status: text("status").$type<"scheduled" | "cancelled">().notNull().default("scheduled"),
    /** Secret behind the rotating check-in code shown in the room. */
    codeSecret: text("code_secret").notNull(),
    /** Check-in is open from when staff open it until they close it (or the session's end plus a grace period). */
    checkInOpenedAt: timestamp("check_in_opened_at", { withTimezone: true }),
    checkInClosedAt: timestamp("check_in_closed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("training_sessions_tenant_idx").on(t.tenantId, t.startsAt)],
);

/** A student present at a training session: checked in with the room's code, or marked by staff. */
export const trainingAttendance = pgTable(
  "training_attendance",
  {
    sessionId: uuid("session_id").notNull().references(() => trainingSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    method: text("method").$type<"code" | "staff">().notNull(),
    late: boolean("late").notNull().default(false),
    markedBy: uuid("marked_by"),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] }), index("training_attendance_user_idx").on(t.userId)],
);

// ---------- Interview experiences ----------

export interface ExperienceRound {
  /** One of the drive's rounds, e.g. "Technical interview". */
  name: string;
  /** What happened and what was asked. */
  description: string;
}

/** A student's write-up of a placement drive they took part in, published once the placement cell approves it. */
export const interviewExperiences = pgTable(
  "interview_experiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    driveId: uuid("drive_id").notNull().references(() => placementDrives.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    result: text("result").$type<"selected" | "not_selected" | "awaiting">().notNull(),
    /** 1 (easy) to 5 (very hard). */
    difficulty: integer("difficulty").notNull(),
    rounds: jsonb("rounds").$type<ExperienceRound[]>().notNull(),
    tips: text("tips").notNull().default(""),
    anonymous: boolean("anonymous").notNull().default(false),
    status: text("status").$type<"pending" | "published" | "rejected">().notNull().default("pending"),
    /** Why it was sent back, for the author. */
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("interview_experiences_drive_user_idx").on(t.driveId, t.userId), index("interview_experiences_tenant_idx").on(t.tenantId, t.status)],
);

// ---------- Mentoring ----------

/** Each student's faculty mentor (one at a time). */
export const mentorAssignments = pgTable(
  "mentor_assignments",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mentorId: uuid("mentor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    assignedBy: uuid("assigned_by").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.studentId] }), index("mentor_assignments_mentor_idx").on(t.mentorId)],
);

/** A mentoring meeting: notes for staff, and action points the student sees. */
export const mentoringMeetings = pgTable(
  "mentoring_meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    mentorId: uuid("mentor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Day of the meeting, "2026-10-27". */
    meetingDate: text("meeting_date").notNull(),
    mode: text("mode").$type<"in_person" | "call" | "online">().notNull(),
    /** For staff only. */
    notes: text("notes").notNull().default(""),
    /** Shown to the student. */
    actionPoints: text("action_points").notNull().default(""),
    followUpOn: text("follow_up_on"),
    createdAt: createdAt(),
  },
  (t) => [index("mentoring_meetings_student_idx").on(t.studentId, t.meetingDate), index("mentoring_meetings_tenant_idx").on(t.tenantId, t.meetingDate)],
);

// ---------- Training feedback ----------

/** An attendee's ratings of a training session, 1-5 each. Staff see them only in aggregate. */
export const trainingFeedback = pgTable(
  "training_feedback",
  {
    sessionId: uuid("session_id").notNull().references(() => trainingSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    content: integer("content").notNull(),
    delivery: integer("delivery").notNull(),
    relevance: integer("relevance").notNull(),
    comment: text("comment").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] }), index("training_feedback_user_idx").on(t.userId)],
);

// ---------- Graduate outcomes ----------

/** An outcome a student reports beyond campus drives, counted once the placement cell verifies it. */
export const studentOutcomes = pgTable(
  "student_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<OutcomeKind>().notNull(),
    /** Company, university, exam or startup name. */
    organisation: text("organisation").notNull(),
    /** Role, programme, score or what the startup does. */
    detail: text("detail").notNull().default(""),
    /** Annual CTC in rupees, for job offers. */
    ctcRupees: integer("ctc_rupees"),
    /** Date of the offer, admission, result or founding, "2026-10-12". */
    outcomeDate: text("outcome_date").notNull(),
    status: text("status").$type<"pending" | "verified" | "rejected">().notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("student_outcomes_user_idx").on(t.userId), index("student_outcomes_tenant_idx").on(t.tenantId, t.status)],
);

// ---------- Progress emails to parents ----------

/** The parent or guardian a student sends a monthly progress email to. A new address is a new row, so old links stop working. */
export const guardians = pgTable("guardians", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relation: text("relation").$type<GuardianRelation>().notNull(),
  email: text("email").notNull(),
  /** Set when the guardian opens the link in the first email; nothing else is sent before. */
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  /** Set when the guardian (or the student) stops the emails. */
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  stoppedBy: text("stopped_by").$type<"guardian" | "student">(),
  confirmationSentAt: timestamp("confirmation_sent_at", { withTimezone: true }),
  /** The last month reported, "2026-10". */
  lastReportMonth: text("last_report_month"),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

// ---------- Circulars ----------

/** A notice from the placement cell to chosen batches, which students may have to acknowledge. */
export const circulars = pgTable(
  "circulars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Batches or sections it is for; empty means every student. */
    unitIds: jsonb("unit_ids").$type<string[]>().notNull(),
    requireAck: boolean("require_ack").notNull().default(false),
    /** Last day to acknowledge, "2026-11-05". */
    ackBy: text("ack_by"),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("circulars_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const circularAcks = pgTable(
  "circular_acks",
  {
    circularId: uuid("circular_id").notNull().references(() => circulars.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.circularId, t.userId] }), index("circular_acks_user_idx").on(t.userId)],
);

// ---------- Document collection ----------

/** Documents the placement cell asks a batch for (marksheets, ID proof), by a date. */
export const documentRequests = pgTable(
  "document_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    /** Batches or sections it is for; empty means every student. */
    unitIds: jsonb("unit_ids").$type<string[]>().notNull(),
    /** Last day to upload, "2026-11-05". */
    dueOn: text("due_on").notNull(),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("document_requests_tenant_idx").on(t.tenantId, t.createdAt)],
);

/** One student's file for a request; uploading again replaces it until it's verified. */
export const documentSubmissions = pgTable(
  "document_submissions",
  {
    requestId: uuid("request_id").notNull().references(() => documentRequests.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").$type<DocumentType>().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").$type<"pending" | "verified" | "rejected">().notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.userId] }), index("document_submissions_user_idx").on(t.userId)],
);

// ---------- Drive-day interview schedules ----------

/** The interview slots for one round of a drive: panels, and when each student goes in. */
export const driveSchedules = pgTable(
  "drive_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driveId: uuid("drive_id").notNull().references(() => placementDrives.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** Index into the drive's rounds. */
    round: integer("round").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    slotMinutes: integer("slot_minutes").notNull(),
    panels: jsonb("panels").$type<Panel[]>().notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("drive_schedules_round_idx").on(t.driveId, t.round)],
);

export interface SlotFeedback {
  ratings: Record<InterviewFeedbackDimension, number>;
  wentWell: string;
  workOn: string;
  by: string;
  at: string;
}

export const driveSlots = pgTable(
  "drive_slots",
  {
    scheduleId: uuid("schedule_id").notNull().references(() => driveSchedules.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    panel: integer("panel").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** An excused absence doesn't count under the no-show rule. */
    status: text("status").$type<"scheduled" | "done" | "no_show" | "excused">().notNull().default("scheduled"),
    /** What the panel said, passed on to the student. */
    feedback: jsonb("feedback").$type<SlotFeedback>(),
  },
  (t) => [primaryKey({ columns: [t.scheduleId, t.userId] }), index("drive_slots_user_idx").on(t.userId)],
);

// ---------- Placement helpdesk ----------

export interface RecordCorrection {
  field: RecordField;
  current: number | null;
  proposed: number;
  status: "pending" | "applied" | "declined";
}

/** A student's query to the placement cell, possibly asking for a correction to their academic record. */
export const helpTickets = pgTable(
  "help_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    category: text("category").$type<HelpCategory>().notNull(),
    subject: text("subject").notNull(),
    status: text("status").$type<"open" | "answered" | "closed">().notNull().default("open"),
    correction: jsonb("correction").$type<RecordCorrection>(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("help_tickets_tenant_idx").on(t.tenantId, t.status, t.updatedAt), index("help_tickets_user_idx").on(t.userId)],
);

export const helpMessages = pgTable(
  "help_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id").notNull().references(() => helpTickets.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    fromStaff: boolean("from_staff").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("help_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

// ---------- Projects and internships ----------

/** A project or internship a student adds to their resume; internships can be verified by the college. */
export const resumeEntries = pgTable(
  "resume_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ResumeEntryKind>().notNull(),
    title: text("title").notNull(),
    /** The company for an internship; for a project, what it was for (a course, a hackathon). */
    organisation: text("organisation").notNull().default(""),
    /** Months, "2026-05"; no end while it's ongoing. */
    startMonth: text("start_month").notNull(),
    endMonth: text("end_month"),
    description: text("description").notNull().default(""),
    link: text("link"),
    verification: text("verification").$type<"none" | "requested" | "verified" | "rejected">().notNull().default("none"),
    verificationNote: text("verification_note"),
    verifiedBy: uuid("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("resume_entries_user_idx").on(t.userId), index("resume_entries_tenant_idx").on(t.tenantId, t.verification)],
);

// ---------- PlayCode tests as drive rounds ----------

/** A drive round run as a PlayCode test, with the cut-off that moves students on. */
export const driveRoundTests = pgTable(
  "drive_round_tests",
  {
    driveId: uuid("drive_id").notNull().references(() => placementDrives.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    cutoffPct: integer("cutoff_pct").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedBy: uuid("applied_by"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.driveId, t.round] })],
);

// ---------- Company relations ----------

/** A company the placement cell is in touch with (or wants to be). */
export const recruiters = pgTable(
  "recruiters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sector: text("sector").notNull().default(""),
    website: text("website"),
    stage: text("stage").$type<CompanyStage>().notNull().default("prospect"),
    notes: text("notes").notNull().default(""),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("recruiters_tenant_name_idx").on(t.tenantId, sql`lower(${t.name})`)],
);

export const recruiterContacts = pgTable(
  "recruiter_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recruiterId: uuid("recruiter_id").notNull().references(() => recruiters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    designation: text("designation").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    createdAt: createdAt(),
  },
  (t) => [index("recruiter_contacts_idx").on(t.recruiterId)],
);

/** A call, email or meeting with a company, and when to follow it up. */
export const recruiterInteractions = pgTable(
  "recruiter_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recruiterId: uuid("recruiter_id").notNull().references(() => recruiters.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").$type<InteractionKind>().notNull(),
    /** Day it happened, "2026-10-29". */
    on: text("on").notNull(),
    note: text("note").notNull(),
    followUpOn: text("follow_up_on"),
    followUpDone: boolean("follow_up_done").notNull().default(false),
    byId: uuid("by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("recruiter_interactions_idx").on(t.recruiterId, t.on), index("recruiter_followups_idx").on(t.tenantId, t.followUpDone, t.followUpOn)],
);

// ---------- Season targets ----------

/** The share of a graduating batch the placement cell aims to place, per department (or the whole institution). */
export const placementTargets = pgTable(
  "placement_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    graduationYear: integer("graduation_year").notNull(),
    /** A department; null for the institution as a whole. */
    unitId: uuid("unit_id").references(() => orgUnits.id, { onDelete: "cascade" }),
    targetPct: integer("target_pct").notNull(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("placement_targets_idx").on(t.tenantId, t.graduationYear, sql`coalesce(${t.unitId}, '00000000-0000-0000-0000-000000000000'::uuid)`)],
);
