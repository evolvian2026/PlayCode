import { sql } from "drizzle-orm";
import {
  boolean,
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
import type { Answer, CodeLanguage, Division, QuestionBody, QuestionType, Role, StudentResponse } from "@playcode/core";

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
  nudges?: boolean;
  /** AI coach hints in practice (on by default when AI is configured). */
  aiHints?: boolean;
  /** AI review of webcam snapshots in strict tests (on by default when AI is configured). */
  aiProctoring?: boolean;
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
    notifyPrefs: jsonb("notify_prefs").$type<{ whatsapp?: boolean }>().notNull().default({}),
    status: text("status").$type<"active" | "disabled" | "erased">().notNull().default("active"),
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
    openAt: timestamp("open_at", { withTimezone: true }).notNull(),
    closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("assignments_tenant_idx").on(t.tenantId)],
);

export type SessionKind = "skill" | "daily" | "pack" | "assignment" | "mistakes";

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

// ---------- Notifications ----------

export type NotificationTemplate = "streak_at_risk" | "assignment_due" | "test_open" | "duel_invite" | "announcement";

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
    kind: text("kind").$type<"mission">().notNull(),
    refId: text("ref_id").notNull(),
    title: text("title").notNull(),
    scorePct: integer("score_pct").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("certificates_user_ref_uq").on(t.userId, t.kind, t.refId)],
);

// ---------- Public API and webhooks ----------

export const API_SCOPES = ["users:read", "users:write", "assignments:read", "assignments:write", "results:read"] as const;
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

export const CONSENT_PURPOSES = ["privacy_notice", "whatsapp"] as const;
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

export type AiFeature = "coach_hint" | "question_draft" | "snapshot_review";

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
