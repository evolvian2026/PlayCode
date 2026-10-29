import { and, asc, eq, inArray } from "drizzle-orm";
import { assignSlots, type Panel } from "@playcode/core";
import type { Db } from "../db/client";
import { driveSchedules, driveSlots, placementApplications, placementDrives, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { getTenant } from "./tenant";

// Interview schedules on a drive day: for a round (say, the technical
// interview), the placement cell lists the panels and rooms, the start time
// and how long each interview takes, and the students still in the selection
// are shared out across the panels by roll number. Each student is told their
// time and room, and sees it on the drive card; on the day, staff mark who
// was interviewed and who didn't turn up.

type Auth = { tenantId: string; userId: string };

export interface ScheduleInput {
  round: number;
  startsAt: Date;
  slotMinutes: number;
  panels: Panel[];
}

const when = (d: Date, timeZone: string) => d.toLocaleString("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

async function loadDrive(db: Db, tenantId: string, id: string) {
  const [d] = await db.select().from(placementDrives).where(and(eq(placementDrives.id, id), eq(placementDrives.tenantId, tenantId)));
  if (!d) throw notFound("Placement drive");
  return d;
}

/** Make (or remake) the schedule for one round, for everyone still in the selection at that round. */
export async function createSchedule(db: Db, auth: Auth, driveId: string, input: ScheduleInput, now: Date) {
  const drive = await loadDrive(db, auth.tenantId, driveId);
  const roundName = drive.rounds[input.round];
  if (!roundName) throw badRequest("That round isn't part of this drive");
  if (input.startsAt <= now) throw badRequest("The interviews must start in the future");
  const apps = await db
    .select({ userId: placementApplications.userId, status: placementApplications.status, roundsCleared: placementApplications.roundsCleared, rollNo: users.rollNo, name: users.name })
    .from(placementApplications)
    .innerJoin(users, eq(users.id, placementApplications.userId))
    .where(eq(placementApplications.driveId, drive.id));
  const due = apps
    .filter((a) => (a.status === "registered" || a.status === "shortlisted") && a.roundsCleared === input.round)
    .sort((a, b) => (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }));
  if (!due.length) throw badRequest(`Nobody is waiting for ${roundName}. Mark who cleared the round before first.`);

  const slots = assignSlots(due, input.panels.length, input.startsAt, input.slotMinutes);
  const schedule = await db.transaction(async (tx) => {
    await tx.delete(driveSchedules).where(and(eq(driveSchedules.driveId, drive.id), eq(driveSchedules.round, input.round)));
    const [s] = await tx.insert(driveSchedules).values({ driveId: drive.id, tenantId: auth.tenantId, round: input.round, startsAt: input.startsAt, slotMinutes: input.slotMinutes, panels: input.panels, createdBy: auth.userId, createdAt: now }).returning();
    await tx.insert(driveSlots).values(slots.map((x) => ({ scheduleId: s!.id, userId: x.student.userId, panel: x.panel, startsAt: x.startsAt })));
    return s!;
  });
  const tenant = await getTenant(db, auth.tenantId);
  await enqueue(
    db,
    slots.map((x) => {
      const p = input.panels[x.panel]!;
      return {
        tenantId: auth.tenantId,
        userId: x.student.userId,
        template: "placement" as const,
        title: `${drive.company} ${roundName}: ${when(x.startsAt, tenant.timeZone)}`,
        body: `${p.name}${p.room ? `, ${p.room}` : ""}. Be there 10 minutes early with your resume and college ID.`,
        link: appLink("/play/placements"),
        // A remade schedule tells everyone their new time.
        dedupeKey: `drive-slot:${schedule.id}:${x.student.userId}`,
        sentBy: auth.userId,
      };
    }),
  );
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.schedule", target: drive.id, data: { round: input.round, students: slots.length } });
  return driveScheduleList(db, auth.tenantId, drive.id);
}

export async function driveScheduleList(db: Db, tenantId: string, driveId: string) {
  const drive = await loadDrive(db, tenantId, driveId);
  const schedules = await db.select().from(driveSchedules).where(eq(driveSchedules.driveId, drive.id)).orderBy(asc(driveSchedules.round));
  const slots = schedules.length
    ? await db
        .select({ slot: driveSlots, name: users.name, rollNo: users.rollNo })
        .from(driveSlots)
        .innerJoin(users, eq(users.id, driveSlots.userId))
        .where(inArray(driveSlots.scheduleId, schedules.map((s) => s.id)))
        .orderBy(asc(driveSlots.startsAt), asc(driveSlots.panel))
    : [];
  return {
    schedules: schedules.map((s) => {
      const mine = slots.filter((x) => x.slot.scheduleId === s.id);
      const last = mine.reduce((t, x) => Math.max(t, x.slot.startsAt.getTime()), s.startsAt.getTime());
      return {
        id: s.id,
        round: s.round,
        roundName: drive.rounds[s.round] ?? "",
        startsAt: s.startsAt,
        endsAt: new Date(last + s.slotMinutes * 60_000),
        slotMinutes: s.slotMinutes,
        panels: s.panels,
        slots: mine.map((x) => ({ userId: x.slot.userId, name: x.name, rollNo: x.rollNo, panel: x.slot.panel, startsAt: x.slot.startsAt, status: x.slot.status })),
      };
    }),
  };
}

export async function markSlot(db: Db, auth: Auth, driveId: string, scheduleId: string, userId: string, status: "scheduled" | "done" | "no_show" | "excused") {
  const drive = await loadDrive(db, auth.tenantId, driveId);
  const [s] = await db.select().from(driveSchedules).where(and(eq(driveSchedules.id, scheduleId), eq(driveSchedules.driveId, drive.id)));
  if (!s) throw notFound("Schedule");
  const [before] = await db.select().from(driveSlots).where(and(eq(driveSlots.scheduleId, s.id), eq(driveSlots.userId, userId)));
  if (!before) throw notFound("Slot");
  await db.update(driveSlots).set({ status }).where(and(eq(driveSlots.scheduleId, s.id), eq(driveSlots.userId, userId)));
  if (status === "no_show" && before.status !== "no_show") {
    await enqueue(db, [
      {
        tenantId: auth.tenantId,
        userId,
        template: "placement",
        title: `${drive.company}: you were marked absent`,
        body: `You missed your ${drive.rounds[s.round] ?? "interview"} slot. If you had a reason, tell your placement cell: missing drives you registered for can stop you registering for new ones.`,
        link: appLink("/play/help"),
        dedupeKey: `drive-no-show:${s.id}:${userId}`,
        sentBy: auth.userId,
      },
    ]);
    void processOutbox(db, new Date()).catch(() => {});
  }
  return { ok: true };
}

/** A student's interview slots, by drive, for their drive cards. */
export async function mySlots(db: Db, tenantId: string, userId: string) {
  const rows = await db
    .select({ slot: driveSlots, schedule: driveSchedules, rounds: placementDrives.rounds })
    .from(driveSlots)
    .innerJoin(driveSchedules, eq(driveSchedules.id, driveSlots.scheduleId))
    .innerJoin(placementDrives, eq(placementDrives.id, driveSchedules.driveId))
    .where(and(eq(driveSlots.userId, userId), eq(driveSchedules.tenantId, tenantId)));
  const out = new Map<string, { round: string; startsAt: Date; panel: Panel; status: string }[]>();
  for (const r of rows) {
    const list = out.get(r.schedule.driveId) ?? out.set(r.schedule.driveId, []).get(r.schedule.driveId)!;
    list.push({ round: r.rounds[r.schedule.round] ?? "", startsAt: r.slot.startsAt, panel: r.schedule.panels[r.slot.panel]!, status: r.slot.status });
  }
  for (const list of out.values()) list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return out;
}
