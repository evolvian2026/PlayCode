import type { Answer, Division, QuestionBody, QuestionType, Role, StudentResponse } from "@playcode/core";

export interface Branding {
  tenantName: string;
  slug: string;
  appName: string;
  primaryColor: string | null;
  logoUrl: string | null;
  certificateSignatory: string | null;
}

export type SsoProvider = "google" | "microsoft" | "oidc" | "saml";

/** Branding as the public sign-in page sees it, plus whether single sign-on is on. */
export interface PublicBranding extends Branding {
  sso: { provider: SsoProvider } | null;
}

export interface Me {
  user: { id: string; name: string; email: string; rollNo: string | null; tenantId: string | null; roles: Role[] };
  tenant: { id: string; name: string; plan: string; type: "institution" | "partner" | "company"; slug: string } | null;
  branding: Branding | null;
  switched: boolean;
  permissions: string[];
  home: "console" | "play";
  mfaSetupRequired?: boolean;
}

export interface ProfileSummary {
  xp: number;
  level: number;
  title: string;
  current: number;
  needed: number;
  streak: { days: number; activeToday: boolean; atRisk: boolean; longest: number; freezesLeft: number };
  hearts: number;
  nextHeartInMs: number | null;
  division: Division;
}

export interface QuestionView {
  id: string;
  type: QuestionType;
  typeLabel: string;
  skillId: string;
  difficulty: 1 | 2 | 3;
  body: QuestionBody;
  hintCount: number;
  hintsUsed: number;
  coachUsed: number;
  responseKind: StudentResponse["kind"];
}

export interface SessionView {
  id: string;
  kind: "skill" | "daily" | "pack" | "assignment" | "mistakes";
  title: string;
  total: number;
  answered: number;
  correctCount: number;
  xpEarned: number;
  usesHearts: boolean;
  finished: boolean;
  passMark: number | null;
  score: number | null;
  passed: boolean | null;
  question: QuestionView | null;
}

export interface TestResult {
  passed: boolean;
  status: "ok" | "compile_error" | "runtime_error" | "timeout" | "output_limit" | "internal_error";
  timeMs: number;
  hidden: boolean;
  input?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
}

export interface SqlResult {
  ok: boolean;
  columns: string[];
  rows: (string | number | null)[][];
  error?: string;
}

export type Evaluation =
  | { kind: "code"; correct: boolean; score: number; passed: number; total: number; compileError?: string; tests: TestResult[] }
  | { kind: "sql"; correct: boolean; score: number; result: SqlResult; expectedColumns?: string[] };

export interface AnswerResult {
  correct: boolean;
  correctAnswer: string;
  answer: Answer;
  evaluation: Evaluation | null;
  explanation: string;
  xp: number;
  xpBreakdown: { label: string; value: number }[];
  levelUp: boolean;
  streakExtended: boolean;
  streakBroken: boolean;
  freezesUsed: number;
  outOfHearts: boolean;
  certificate: string | null;
  /** Learning paths this answer completed (it finished the last step). */
  pathsCompleted?: { pathId: string; title: string; code: string }[];
  profile: ProfileSummary;
  session: SessionView;
}

export interface StudentDetail {
  user: { id: string; name: string; email: string; rollNo: string | null; lastActiveAt: string | null };
  xp: number;
  level: number;
  title: string;
  current: number;
  needed: number;
  streak: number;
  longestStreak: number;
  division: Division;
  correctAnswers: number;
  openMistakes: number;
  readiness: { id: string; name: string; score: number }[];
  skills: { skillId: string; name: string; topic: string; topicName: string; mastery: number; attempts: number; accuracyPct: number | null; lastPractisedAt: string | null }[];
  badges: { code: string; name: string; description: string; kind: string }[];
  recentSessions: { id: string; kind: string; startedAt: string; finished: boolean; correctCount: number; total: number; xpEarned: number }[];
}

export interface OrgUnit {
  id: string;
  name: string;
  kind: "department" | "batch" | "section";
  parentId: string | null;
  students: number;
}

export interface TestListItem {
  id: string;
  title: string;
  proctorLevel: 1 | 2;
  durationMinutes: number;
  openAt: string;
  closeAt: string;
  questionCount: number;
  state: "upcoming" | "open" | "in_progress" | "submitted" | "missed";
  attemptId: string | null;
  score: number | null;
  maxScore: number | null;
}

export interface StudentPathStep {
  id: string;
  kind: "skill" | "pack";
  ref: string;
  title: string;
  target: number;
  dueDays: number | null;
  state: "done" | "current" | "open" | "locked";
  value: number | null;
  dueAt: string | null;
  overdue: boolean;
}

export interface StudentPath {
  id: string;
  title: string;
  description: string;
  sequential: boolean;
  steps: StudentPathStep[];
  done: number;
  certificate: string | null;
}
