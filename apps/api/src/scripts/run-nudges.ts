import { db, pool } from "../db/client";
import { sendBillingNotices } from "../services/billing-mail";
import { finalizeContests } from "../services/contests";
import { finalizeExpiredMocks } from "../services/mocks";
import { squadReminders } from "../services/squads";
import { slotReminders } from "../services/interview-slots";
import { trainingReminders } from "../services/training";
import { recordJob } from "../services/jobs";
import { processOutbox } from "../services/notifications";
import { runNudges } from "../services/nudges";
import { sendDueReports } from "../services/reports";
import { sendGuardianReports } from "../services/guardians";
import { reviewPendingSnapshots } from "../services/snapshot-review";

// Hourly job: queue automatic nudges (streaks, due assignments, open tests)
// and deliver everything pending; also catch up on webcam snapshots of
// level-3 tests that missed their AI review, email the weekly reports that
// are due, send billing emails (new invoices, reminders, licence renewals),
// publish results, ratings and certificates of contests that have ended, and
// send parents last month's progress email in the first week of a month.
// Usage: pnpm nudges:run
const now = new Date();
try {
  console.log(
    await recordJob(db, "nudges", now, async () => ({
      queued: await runNudges(db, now),
      contestsFinalized: (await finalizeContests(db, now)).finalized,
      mocksFinalized: (await finalizeExpiredMocks(db, now)).finalized,
      squadReminders: await squadReminders(db, now),
      interviewReminders: await slotReminders(db, now),
      trainingReminders: await trainingReminders(db, now),
      delivered: await processOutbox(db, now, 5000),
      snapshotsReviewed: await reviewPendingSnapshots(db, now),
      reports: await sendDueReports(db, now),
      billingEmails: await sendBillingNotices(db, now),
      guardianEmails: await sendGuardianReports(db, now),
    })),
  );
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
