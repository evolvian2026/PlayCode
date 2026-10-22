// Role-based access. Roles are permission sets; scope (which org units a
// user may act on) comes from their memberships and is checked by the API.

export const PERMISSIONS = [
  "tenants.manage",
  "tenant.settings",
  "users.manage",
  "content.global.manage",
  "content.private.manage",
  "content.view",
  "assignments.manage",
  "assessments.manage",
  "assessments.proctor",
  "events.manage",
  "nudges.send",
  "leagues.manage",
  "analytics.institution",
  "analytics.department",
  "analytics.own_units",
  "reports.export",
  "audit.view",
  "api.manage",
  "practice.play",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  "super_admin",
  "content_manager",
  "partner_admin",
  "inst_admin",
  "tpo",
  "hod",
  "faculty",
  "proctor",
  "student",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Platform Super Admin",
  content_manager: "Content Manager",
  partner_admin: "Partner Admin",
  inst_admin: "Institution Admin",
  tpo: "Training & Placement Officer",
  hod: "Head of Department",
  faculty: "Faculty / Trainer",
  proctor: "Proctor",
  student: "Student",
};

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    "tenants.manage",
    "tenant.settings",
    "users.manage",
    "content.global.manage",
    "content.view",
    "analytics.institution",
    "reports.export",
    "audit.view",
    "leagues.manage",
    "events.manage",
    "api.manage",
  ],
  content_manager: ["content.global.manage", "content.view"],
  partner_admin: [
    "tenants.manage",
    "tenant.settings",
    "users.manage",
    "content.private.manage",
    "content.view",
    "assignments.manage",
    "assessments.manage",
    "assessments.proctor",
    "events.manage",
    "nudges.send",
    "analytics.institution",
    "reports.export",
    "audit.view",
    "leagues.manage",
    "api.manage",
  ],
  inst_admin: [
    "tenant.settings",
    "users.manage",
    "content.private.manage",
    "content.view",
    "assignments.manage",
    "assessments.manage",
    "assessments.proctor",
    "events.manage",
    "nudges.send",
    "analytics.institution",
    "reports.export",
    "audit.view",
    "leagues.manage",
    "api.manage",
  ],
  tpo: [
    "users.manage",
    "content.private.manage",
    "content.view",
    "assignments.manage",
    "assessments.manage",
    "assessments.proctor",
    "events.manage",
    "nudges.send",
    "analytics.institution",
    "reports.export",
    "leagues.manage",
  ],
  hod: ["content.private.manage", "content.view", "assignments.manage", "assessments.manage", "assessments.proctor", "events.manage", "nudges.send", "analytics.department", "reports.export"],
  faculty: ["content.view", "assignments.manage", "assessments.manage", "assessments.proctor", "nudges.send", "analytics.own_units", "reports.export"],
  proctor: ["assessments.proctor", "analytics.own_units"],
  student: ["practice.play"],
};

export function permissionsFor(roles: Role[]): Set<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
}

export function can(roles: Role[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

/** Staff roles use the console; students use the player. */
export function isStaff(roles: Role[]): boolean {
  return roles.some((r) => r !== "student");
}

/** True when the user's analytics scope is the whole institution. */
export function hasInstitutionScope(roles: Role[]): boolean {
  return can(roles, "analytics.institution");
}
