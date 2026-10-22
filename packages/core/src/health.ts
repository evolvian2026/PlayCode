// Customer health for PlayCode staff and partners: is an institution getting
// value from PlayCode, and is the account at risk at renewal? The thresholds
// follow the pilot goals: 40% of students active weekly, and placement
// officers using the console every week.

export type HealthStatus = "healthy" | "watch" | "at_risk";

export interface HealthMetrics {
  students: number;
  seats: number;
  /** Students who answered at least one question in the last 7 days. */
  weeklyActive: number;
  /** Staff who used the console in the last 7 and 14 days. */
  staffActive7: number;
  staffActive14: number;
  /** Days until the licence ends (null: no end date). */
  licenceDaysLeft: number | null;
  /** Days the oldest unpaid invoice is past due (0: none overdue). */
  overdueDays: number;
}

export interface Health {
  status: HealthStatus;
  reasons: string[];
}

export function assessHealth(m: HealthMetrics): Health {
  const risk: string[] = [];
  const watch: string[] = [];
  const wauPct = m.students ? (m.weeklyActive / m.students) * 100 : 0;
  if (m.students === 0) watch.push("No students yet");
  else if (wauPct < 20) risk.push(`Only ${Math.round(wauPct)}% of students active this week`);
  else if (wauPct < 40) watch.push(`${Math.round(wauPct)}% of students active this week (goal 40%)`);
  if (m.students > 0 && m.staffActive14 === 0) risk.push("No staff have used the console in 2 weeks");
  else if (m.students > 0 && m.staffActive7 === 0) watch.push("No staff used the console this week");
  if (m.seats > 0 && m.students / m.seats < 0.3 && m.students > 0) watch.push(`${Math.round((m.students / m.seats) * 100)}% of seats in use`);
  if (m.licenceDaysLeft !== null) {
    if (m.licenceDaysLeft < 0) risk.push("Licence has expired");
    else if (m.licenceDaysLeft <= 60) watch.push(`Licence ends in ${m.licenceDaysLeft} days`);
  }
  if (m.overdueDays > 30) risk.push(`Invoice overdue by ${m.overdueDays} days`);
  else if (m.overdueDays > 0) watch.push(`Invoice overdue by ${m.overdueDays} days`);
  return { status: risk.length ? "at_risk" : watch.length ? "watch" : "healthy", reasons: [...risk, ...watch] };
}
