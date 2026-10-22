// Badges are derived from stats, so they can be recomputed at any time and
// new badges apply retroactively.

export interface BadgeStats {
  correctAnswers: number;
  longestStreak: number;
  level: number;
  masteredSkills: number; // skills with mastery >= 80
  missionsPassed: number;
  perfectSessions: number;
}

export interface BadgeDefinition {
  code: string;
  name: string;
  description: string;
  kind: "skill" | "habit" | "progress";
  earned: (s: BadgeStats) => boolean;
}

export const BADGES: BadgeDefinition[] = [
  { code: "first_blood", name: "First Blood", description: "Answer your first question correctly", kind: "progress", earned: (s) => s.correctAnswers >= 1 },
  { code: "century", name: "Century", description: "100 correct answers", kind: "progress", earned: (s) => s.correctAnswers >= 100 },
  { code: "streak_7", name: "Week Warrior", description: "7-day streak", kind: "habit", earned: (s) => s.longestStreak >= 7 },
  { code: "streak_30", name: "Unstoppable", description: "30-day streak", kind: "habit", earned: (s) => s.longestStreak >= 30 },
  { code: "level_10", name: "Coder", description: "Reach level 10", kind: "progress", earned: (s) => s.level >= 10 },
  { code: "skill_master", name: "Skill Master", description: "Master a skill (80+)", kind: "skill", earned: (s) => s.masteredSkills >= 1 },
  { code: "polymath", name: "Polymath", description: "Master 5 skills", kind: "skill", earned: (s) => s.masteredSkills >= 5 },
  { code: "mission_ready", name: "Mission Ready", description: "Pass a company mission", kind: "skill", earned: (s) => s.missionsPassed >= 1 },
  { code: "flawless", name: "Flawless", description: "Finish a set with every answer right", kind: "skill", earned: (s) => s.perfectSessions >= 1 },
];

export function earnedBadges(stats: BadgeStats): BadgeDefinition[] {
  return BADGES.filter((b) => b.earned(stats));
}
