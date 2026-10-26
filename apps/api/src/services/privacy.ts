import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import {
  academicRecords,
  assessmentAttempts,
  assessments,
  attemptSnapshots,
  auditLogs,
  authSessions,
  certificates,
  coachHints,
  contestSubmissions,
  mockAttempts,
  squadMembers,
  doubts,
  codeReviews,
  interviewSlots,
  squads,
  contests,
  consents,
  driveCandidates,
  drives,
  duelPlayers,
  duels,
  erasureRequests,
  integrityEvents,
  interviews,
  leagueMembers,
  liveQuizAnswers,
  liveQuizPlayers,
  liveQuizzes,
  loginCodes,
  ltiAccounts,
  ltiScores,
  memberships,
  mistakes,
  notifications,
  orgUnits,
  placementApplications,
  placementDrives,
  playerProfiles,
  pushSubscriptions,
  studentProfiles,
  responses,
  sessions,
  skillRatings,
  studyPlans,
  talentInvites,
  tenants,
  users,
  type ConsentPurpose,
} from "../db/schema";
import { audit } from "../lib/audit";
import { conflict, forbidden, notFound } from "../lib/errors";
import { deleteObject } from "../lib/storage";
import { deliverDue, emitEvent } from "./webhooks";
import { leaveSquad } from "./squads";
import { forgetBookings } from "./interview-slots";

// Data-protection tools in the spirit of India's DPDP Act 2023 (and GDPR):
// a consent ledger, a copy of everything held about a person, and erasure on
// request. Erasure anonymises the user row rather than deleting it, so
// aggregate numbers (attempts per question, cohort sizes) stay consistent
// while nothing left can identify the person.

/** Bump when the privacy notice text changes; people who agreed to an older version are asked again. */
export const NOTICE_VERSION = "2026-10";

export async function recordConsent(
  db: DbOrTx,
  entry: { tenantId: string | null; userId: string; purpose: ConsentPurpose; granted: boolean; source: "app" | "drive_apply" | "settings"; now?: Date },
) {
  await db.insert(consents).values({
    tenantId: entry.tenantId,
    userId: entry.userId,
    purpose: entry.purpose,
    granted: entry.granted,
    noticeVersion: NOTICE_VERSION,
    source: entry.source,
    ...(entry.now ? { createdAt: entry.now } : {}),
  });
}

/** The latest decision per purpose, plus the full history. */
export async function consentState(db: DbOrTx, userId: string) {
  const history = await db.select().from(consents).where(eq(consents.userId, userId)).orderBy(desc(consents.createdAt));
  const latest = (p: ConsentPurpose) => history.find((h) => h.purpose === p) ?? null;
  const notice = latest("privacy_notice");
  return {
    noticeVersion: NOTICE_VERSION,
    noticeAccepted: Boolean(notice?.granted && notice.noticeVersion === NOTICE_VERSION),
    history: history.map((h) => ({ purpose: h.purpose, granted: h.granted, noticeVersion: h.noticeVersion, source: h.source, at: h.createdAt })),
  };
}

/** Everything held about one person, as plain JSON. Proctoring images are listed, not embedded. */
export async function exportUserData(db: Db, userId: string, now: Date) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw notFound("User");
  const { passwordHash: _omit, ...account } = user;
  const attempts = await db
    .select({ attempt: assessmentAttempts, title: assessments.title })
    .from(assessmentAttempts)
    .innerJoin(assessments, eq(assessments.id, assessmentAttempts.assessmentId))
    .where(eq(assessmentAttempts.userId, userId));
  const attemptIds = attempts.map((a) => a.attempt.id);
  const [events, snapshots] = attemptIds.length
    ? await Promise.all([
        db.select().from(integrityEvents).where(inArray(integrityEvents.attemptId, attemptIds)),
        db.select({ attemptId: attemptSnapshots.attemptId, at: attemptSnapshots.at, contentType: attemptSnapshots.contentType }).from(attemptSnapshots).where(inArray(attemptSnapshots.attemptId, attemptIds)),
      ])
    : [[], []];

  return {
    exportedAt: now.toISOString(),
    noticeVersion: NOTICE_VERSION,
    account,
    memberships: await db
      .select({ role: memberships.role, unit: orgUnits.name, unitKind: orgUnits.kind })
      .from(memberships)
      .leftJoin(orgUnits, eq(orgUnits.id, memberships.orgUnitId))
      .where(eq(memberships.userId, userId)),
    profile: (await db.select().from(playerProfiles).where(eq(playerProfiles.userId, userId)))[0] ?? null,
    skillRatings: await db.select().from(skillRatings).where(eq(skillRatings.userId, userId)),
    practiceSessions: await db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(sessions.startedAt),
    answers: await db.select().from(responses).where(eq(responses.userId, userId)).orderBy(responses.createdAt),
    mistakes: await db.select().from(mistakes).where(eq(mistakes.userId, userId)),
    leagues: await db.select().from(leagueMembers).where(eq(leagueMembers.userId, userId)),
    duels: await db.select().from(duelPlayers).where(eq(duelPlayers.userId, userId)),
    assessments: attempts.map(({ attempt, title }) => ({
      assessment: title,
      ...attempt,
      integrityEvents: events.filter((e) => e.attemptId === attempt.id).map(({ type, detail, at }) => ({ type, detail, at })),
      proctoringSnapshots: snapshots.filter((s) => s.attemptId === attempt.id).map(({ at, contentType }) => ({ at, contentType })),
    })),
    certificates: await db.select().from(certificates).where(eq(certificates.userId, userId)),
    hiringDrives: await db
      .select({ drive: drives.title, role: drives.roleTitle, status: driveCandidates.status, college: driveCandidates.college, appliedAt: driveCandidates.createdAt })
      .from(driveCandidates)
      .innerJoin(drives, eq(drives.id, driveCandidates.driveId))
      .where(eq(driveCandidates.userId, userId)),
    coachHints: await db.select({ questionId: coachHints.questionId, hint: coachHints.hint, at: coachHints.createdAt }).from(coachHints).where(eq(coachHints.userId, userId)),
    academicRecord: (await db.select().from(academicRecords).where(eq(academicRecords.userId, userId)))[0] ?? null,
    resumeProfile: (await db.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)))[0] ?? null,
    placements: await db
      .select({ company: placementDrives.company, role: placementDrives.roleTitle, status: placementApplications.status, roundsCleared: placementApplications.roundsCleared, offerCtcRupees: placementApplications.offerCtcRupees, registeredAt: placementApplications.createdAt })
      .from(placementApplications)
      .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
      .where(eq(placementApplications.userId, userId)),
    liveQuizAnswers: await db
      .select({ quiz: liveQuizzes.title, question: liveQuizAnswers.questionIndex, response: liveQuizAnswers.response, correct: liveQuizAnswers.correct, points: liveQuizAnswers.points, at: liveQuizAnswers.answeredAt })
      .from(liveQuizAnswers)
      .innerJoin(liveQuizzes, eq(liveQuizzes.id, liveQuizAnswers.quizId))
      .where(eq(liveQuizAnswers.userId, userId)),
    studyPlan: (await db.select({ target: studyPlans.target, days: studyPlans.days, createdAt: studyPlans.createdAt }).from(studyPlans).where(eq(studyPlans.userId, userId)))[0] ?? null,
    contestSubmissions: await db
      .select({ contest: contests.title, questionId: contestSubmissions.questionId, response: contestSubmissions.response, verdict: contestSubmissions.verdict, afterTheContest: contestSubmissions.upsolve, submittedAt: contestSubmissions.createdAt })
      .from(contestSubmissions)
      .innerJoin(contests, eq(contests.id, contestSubmissions.contestId))
      .where(eq(contestSubmissions.userId, userId)),
    codeReviews: await db.select({ questionId: codeReviews.questionId, review: codeReviews.review, at: codeReviews.createdAt }).from(codeReviews).where(eq(codeReviews.userId, userId)),
    panelInterviews: await db.select({ interviewer: interviewSlots.interviewerName, kind: interviewSlots.kind, startsAt: interviewSlots.startsAt, status: interviewSlots.status, feedback: interviewSlots.feedback }).from(interviewSlots).where(eq(interviewSlots.bookedBy, userId)),
    doubts: await db.select({ questionId: doubts.questionId, text: doubts.text, status: doubts.status, answer: doubts.answer, askedAt: doubts.createdAt, answeredAt: doubts.answeredAt }).from(doubts).where(eq(doubts.userId, userId)),
    squad: (await db.select({ name: squads.name, joinedAt: squadMembers.joinedAt }).from(squadMembers).innerJoin(squads, eq(squads.id, squadMembers.squadId)).where(eq(squadMembers.userId, userId)))[0] ?? null,
    mockTests: await db
      .select({ pattern: mockAttempts.pattern, questions: mockAttempts.questions, answers: mockAttempts.answers, status: mockAttempts.status, startedAt: mockAttempts.startedAt, submittedAt: mockAttempts.submittedAt, sections: mockAttempts.sectionScores })
      .from(mockAttempts)
      .where(eq(mockAttempts.userId, userId)),
    talentInvitations: await db
      .select({ company: tenants.name, roleTitle: talentInvites.roleTitle, message: talentInvites.message, status: talentInvites.status, sentAt: talentInvites.createdAt, respondedAt: talentInvites.respondedAt })
      .from(talentInvites)
      .innerJoin(tenants, eq(tenants.id, talentInvites.companyId))
      .where(eq(talentInvites.userId, userId)),
    mockInterviews: await db.select({ track: interviews.track, status: interviews.status, turns: interviews.turns, scorecard: interviews.scorecard, startedAt: interviews.startedAt }).from(interviews).where(eq(interviews.userId, userId)),
    notifications: await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(notifications.createdAt),
    consents: (await consentState(db, userId)).history,
    erasureRequests: await db.select().from(erasureRequests).where(eq(erasureRequests.userId, userId)),
  };
}

export async function requestErasure(db: Db, args: { tenantId: string; userId: string; reason: string | null; now: Date }) {
  const [open] = await db.select().from(erasureRequests).where(and(eq(erasureRequests.userId, args.userId), eq(erasureRequests.status, "pending")));
  if (open) throw conflict("pending", "You already have a deletion request waiting");
  const [created] = await db.insert(erasureRequests).values({ tenantId: args.tenantId, userId: args.userId, reason: args.reason, createdAt: args.now }).returning();
  await audit(db, { tenantId: args.tenantId, actorId: args.userId, action: "privacy.erasure_requested", target: created!.id });
  return created!;
}

export async function cancelErasure(db: Db, userId: string, now: Date) {
  const [row] = await db
    .update(erasureRequests)
    .set({ status: "cancelled", resolvedAt: now, resolvedBy: userId })
    .where(and(eq(erasureRequests.userId, userId), eq(erasureRequests.status, "pending")))
    .returning();
  if (!row) throw notFound("Pending request");
  await audit(db, { tenantId: row.tenantId, actorId: userId, action: "privacy.erasure_cancelled", target: row.id });
}

export async function listErasureRequests(db: Db, tenantId: string) {
  return db
    .select({
      id: erasureRequests.id,
      userId: erasureRequests.userId,
      name: users.name,
      email: users.email,
      rollNo: users.rollNo,
      reason: erasureRequests.reason,
      status: erasureRequests.status,
      resolution: erasureRequests.resolution,
      createdAt: erasureRequests.createdAt,
      resolvedAt: erasureRequests.resolvedAt,
    })
    .from(erasureRequests)
    .innerJoin(users, eq(users.id, erasureRequests.userId))
    .where(eq(erasureRequests.tenantId, tenantId))
    .orderBy(sql`${erasureRequests.status} = 'pending' desc`, desc(erasureRequests.createdAt))
    .limit(500);
}

/**
 * Approve (erase) or reject a pending request. Erasure removes practice
 * history, answers, test attempts with their proctoring evidence,
 * certificates, notifications and hiring-drive records, and anonymises the
 * account. The consent ledger and the request itself are kept as the record
 * that the request was honoured.
 */
export async function resolveErasure(
  db: Db,
  args: { tenantId: string; actorId: string; requestId: string; decision: "erase" | "reject"; note: string | null; inScope: (userId: string) => Promise<boolean>; now: Date },
) {
  const [req] = await db.select().from(erasureRequests).where(and(eq(erasureRequests.id, args.requestId), eq(erasureRequests.tenantId, args.tenantId)));
  if (!req) throw notFound("Request");
  if (req.status !== "pending") throw conflict("resolved", "This request has already been handled");
  if (!(await args.inScope(req.userId))) throw forbidden("This student is outside your scope");

  if (args.decision === "reject") {
    if (!args.note) throw conflict("note_required", "Tell the student why the request was declined");
    await db.update(erasureRequests).set({ status: "rejected", resolution: args.note, resolvedBy: args.actorId, resolvedAt: args.now }).where(eq(erasureRequests.id, req.id));
    await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "privacy.erasure_rejected", target: req.id, data: { userId: req.userId } });
    return { status: "rejected" as const };
  }

  const { snapshotKeys, queued } = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, req.userId)).for("update");
    if (!user) throw notFound("User");
    const attemptIds = (await tx.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(eq(assessmentAttempts.userId, user.id))).map((a) => a.id);
    const snapshotKeys = attemptIds.length
      ? (await tx.select({ key: attemptSnapshots.storageKey }).from(attemptSnapshots).where(inArray(attemptSnapshots.attemptId, attemptIds))).map((s) => s.key)
      : [];
    // Attempts cascade to integrity events, snapshots and similarity pairs; sessions to responses.
    await tx.delete(assessmentAttempts).where(eq(assessmentAttempts.userId, user.id));
    await tx.delete(responses).where(eq(responses.userId, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    await tx.delete(mistakes).where(eq(mistakes.userId, user.id));
    await tx.delete(skillRatings).where(eq(skillRatings.userId, user.id));
    await tx.delete(leagueMembers).where(eq(leagueMembers.userId, user.id));
    await tx.delete(notifications).where(eq(notifications.userId, user.id));
    await tx.delete(coachHints).where(eq(coachHints.userId, user.id));
    await tx.delete(ltiScores).where(eq(ltiScores.userId, user.id));
    await tx.delete(ltiAccounts).where(eq(ltiAccounts.userId, user.id));
    await tx.delete(authSessions).where(eq(authSessions.userId, user.id));
    await tx.delete(loginCodes).where(eq(loginCodes.userId, user.id));
    await tx.delete(certificates).where(eq(certificates.userId, user.id));
    await tx.delete(driveCandidates).where(eq(driveCandidates.userId, user.id));
    await tx.delete(placementApplications).where(eq(placementApplications.userId, user.id));
    await tx.delete(academicRecords).where(eq(academicRecords.userId, user.id));
    await tx.delete(interviews).where(eq(interviews.userId, user.id));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    await tx.delete(studentProfiles).where(eq(studentProfiles.userId, user.id));
    await tx.delete(talentInvites).where(eq(talentInvites.userId, user.id));
    // Contest code goes; the student drops off past scoreboards.
    await tx.delete(contestSubmissions).where(eq(contestSubmissions.userId, user.id));
    await tx.delete(studyPlans).where(eq(studyPlans.userId, user.id));
    await tx.delete(mockAttempts).where(eq(mockAttempts.userId, user.id));
    await leaveSquad(tx, user.id);
    await tx.delete(doubts).where(eq(doubts.userId, user.id));
    await tx.delete(codeReviews).where(eq(codeReviews.userId, user.id));
    await forgetBookings(tx, user.id);
    await tx.delete(liveQuizAnswers).where(eq(liveQuizAnswers.userId, user.id));
    await tx.delete(liveQuizPlayers).where(eq(liveQuizPlayers.userId, user.id));
    await tx.delete(playerProfiles).where(eq(playerProfiles.userId, user.id));
    await tx.delete(memberships).where(eq(memberships.userId, user.id));
    // Duels stay so opponents keep their history; the player now shows as "Deleted user".
    await tx.update(duels).set({ status: "cancelled" }).where(and(or(eq(duels.challengerId, user.id), eq(duels.opponentId, user.id)), inArray(duels.status, ["waiting", "active"])));
    await tx
      .update(users)
      .set({ name: "Deleted user", email: `erased-${user.id}@erased.invalid`, rollNo: null, phone: null, notifyPrefs: {}, passwordHash: "!", status: "erased", scimExternalId: null, lastActiveAt: null, totpSecretEnc: null, totpPendingEnc: null, recoveryCodes: [] })
      .where(eq(users.id, user.id));
    // Audit entries stay (they record who did what) but lose the email address.
    await tx.execute(sql`update ${auditLogs} set data = data - 'email' where data->>'email' = ${user.email}`);
    await tx.update(erasureRequests).set({ status: "completed", resolution: args.note, resolvedBy: args.actorId, resolvedAt: args.now }).where(eq(erasureRequests.id, req.id));
    await audit(tx, { tenantId: args.tenantId, actorId: args.actorId, action: "privacy.erased", target: req.id, data: { userId: user.id } });
    const queued = await emitEvent(tx, args.tenantId, "user.erased", { userId: user.id }, args.now);
    return { snapshotKeys, queued };
  });

  await Promise.all(snapshotKeys.map((k) => deleteObject(k).catch(() => {})));
  if (queued) void deliverDue(db, args.now).catch(() => {});
  return { status: "completed" as const };
}
