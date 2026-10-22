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
import type { Answer, Division, QuestionBody, QuestionType, Role, StudentResponse } from "@playcode/core";

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
  settings: jsonb("settings").$type<{ weekendsOptional?: boolean }>().notNull().default({}),
  createdAt: createdAt(),
});

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
    status: text("status").$type<"active" | "disabled">().notNull().default("active"),
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
    createdAt: createdAt(),
  },
  (t) => [index("questions_skill_idx").on(t.skillId)],
);

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
