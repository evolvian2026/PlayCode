"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { planHas, ROLE_LABELS, type Feature, type Plan } from "@playcode/core";
import { AuthGate, signOut, switchTenant, useMe } from "@/components/Auth";
import { LicenceBanner } from "@/components/LicenceBanner";
import { Icon } from "@/components/Icon";
import { logoSrc } from "@/lib/branding";

type NavItem = { href: string; label: string; icon: string; perm: string | string[] | null; feature?: Feature; tenantOnly?: boolean; superAdmin?: boolean; accounts?: boolean; company?: boolean; noCompany?: boolean };

const NAV: NavItem[] = [
  { href: "/console", label: "Overview", icon: "chart", perm: null },
  { href: "/console/students", label: "Students", icon: "users", perm: null },
  { href: "/console/assignments", label: "Assignments", icon: "clipboard", perm: "assignments.manage" },
  { href: "/console/papers", label: "Question papers", icon: "clipboard", perm: "assignments.manage" },
  { href: "/console/paths", label: "Learning paths", icon: "map", perm: "assignments.manage", feature: "learning_paths" },
  { href: "/console/tests", label: "Tests", icon: "flag", perm: "assessments.proctor" },
  { href: "/console/doubts", label: "Doubts", icon: "chat", perm: "doubts.answer", noCompany: true },
  { href: "/console/placements", label: "Placements", icon: "briefcase", perm: "placements.manage", feature: "placements" },
  { href: "/console/training", label: "Training sessions", icon: "calendar", perm: ["placements.manage", "assignments.manage"], noCompany: true },
  { href: "/console/interview-slots", label: "Interview slots", icon: "users", perm: ["placements.manage", "assignments.manage"], noCompany: true },
  { href: "/console/interviews", label: "Mock interviews", icon: "chat", perm: ["analytics.institution", "analytics.department", "analytics.own_units"], feature: "ai_interviews" },
  { href: "/console/writing", label: "Written English", icon: "book", perm: ["analytics.institution", "analytics.department", "analytics.own_units"], feature: "ai_coach" },
  { href: "/console/gd", label: "Group discussions", icon: "users", perm: ["analytics.institution", "analytics.department", "analytics.own_units"], feature: "ai_interviews" },
  { href: "/console/drives", label: "Hiring drives", icon: "users", perm: "drives.manage", feature: "hiring_drives" },
  { href: "/console/talent", label: "Talent pool", icon: "user", perm: "drives.manage", feature: "talent_search", company: true },
  { href: "/console/live", label: "Live quiz", icon: "bolt", perm: "assignments.manage", noCompany: true },
  { href: "/console/contests", label: "Contests", icon: "trophy", perm: ["events.manage", "analytics.institution", "analytics.department", "analytics.own_units"], noCompany: true },
  { href: "/console/engage", label: "Engagement", icon: "megaphone", perm: null },
  { href: "/console/batches", label: "Batches", icon: "layers", perm: null },
  { href: "/console/reports", label: "Reports", icon: "chart", perm: ["analytics.institution", "analytics.department", "analytics.own_units"] },
  { href: "/console/activity", label: "Accreditation report", icon: "award", perm: ["analytics.institution", "analytics.department", "analytics.own_units"], noCompany: true },
  { href: "/console/content", label: "Question bank", icon: "book", perm: "content.view" },
  { href: "/console/studio", label: "Content studio", icon: "spark", perm: ["content.private.manage", "content.global.manage"], feature: "content_studio" },
  { href: "/console/integrations", label: "Integrations", icon: "layers", perm: "api.manage", feature: "api" },
  { href: "/console/privacy", label: "Privacy requests", icon: "shield", perm: "users.manage" },
  { href: "/console/audit", label: "Audit log", icon: "list", perm: "audit.view" },
  { href: "/console/settings", label: "Settings", icon: "settings", perm: "tenant.settings" },
  { href: "/console/billing", label: "Plan & billing", icon: "clipboard", perm: "tenant.settings", tenantOnly: true },
  { href: "/console/billing", label: "Invoicing", icon: "clipboard", perm: null, superAdmin: true },
  { href: "/console/health", label: "Customer health", icon: "chart", perm: "tenants.manage", accounts: true },
  { href: "/console/system", label: "System status", icon: "settings", perm: null, superAdmin: true },
];

/** Hide what the role can't use, and what the institution's plan doesn't include (PlayCode staff outside an institution see everything). */
function visible(n: NavItem, me: { permissions: string[]; user: { roles: string[] }; tenant: { plan: string; type?: string } | null }) {
  if (n.superAdmin) return me.user.roles.includes("super_admin") && !me.tenant;
  if (n.tenantOnly && !me.tenant) return false;
  if (n.company && me.tenant?.type !== "company") return false;
  if (n.noCompany && me.tenant?.type === "company") return false;
  // Account views: PlayCode staff outside an institution, or a partner looking at its colleges.
  if (n.accounts && !(me.tenant ? me.tenant.type === "partner" : me.user.roles.includes("super_admin"))) return false;
  if (n.perm && ![n.perm].flat().some((p) => me.permissions.includes(p))) return false;
  if (n.feature && me.tenant && !planHas(me.tenant.plan as Plan, n.feature)) return false;
  return true;
}

function Side() {
  const me = useMe();
  const path = usePathname();
  return (
    <nav className="console-side" aria-label="Console">
      <div className="brand">
        <img src={logoSrc(me.branding)} alt="" style={{ objectFit: "contain" }} />
        {me.branding?.appName ?? "PlayCode"}
      </div>
      {me.tenant?.type === "partner" && (
        <Link href="/console/partner" className={path.startsWith("/console/partner") ? "active" : ""}>
          <span className="row" style={{ gap: 10 }}>
            <Icon name="users" size={18} /> Colleges
          </span>
        </Link>
      )}
      {NAV.filter((n) => visible(n, me)).map((n) => {
        const active = n.href === "/console" ? path === "/console" : path.startsWith(n.href);
        return (
          <Link key={n.label} href={n.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <span className="row" style={{ gap: 10 }}>
              <Icon name={n.icon} size={18} /> {n.label}
            </span>
          </Link>
        );
      })}
      <div style={{ marginTop: "auto", padding: "16px 12px 0" }} className="small">
        <Link href="/console/account" style={{ fontWeight: 600, color: "inherit" }}>
          {me.user.name}
        </Link>
        <div className="muted">{me.user.roles.map((r) => ROLE_LABELS[r]).join(", ")}</div>
        <div className="muted">{me.tenant?.name}</div>
        <button className="btn small ghost" style={{ paddingLeft: 0, marginTop: 8 }} onClick={signOut}>
          <Icon name="logout" size={16} /> Sign out
        </button>
      </div>
    </nav>
  );
}

function SwitchedBanner() {
  const me = useMe();
  if (!me.switched) return null;
  return (
    <div className="spread" style={{ background: "var(--warn-soft)", color: "var(--warn-ink)", padding: "8px 16px", borderRadius: 10, marginBottom: 16, fontWeight: 600 }}>
      <span>You are working inside {me.tenant?.name}. Changes are recorded under your name.</span>
      <button className="btn small" onClick={() => void switchTenant(null)}>
        Return to my account
      </button>
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate area="console">
      <div className="console-shell">
        <Side />
        <main className="console-main">
          <SwitchedBanner />
          <LicenceBanner area="console" />
          {children}
        </main>
      </div>
    </AuthGate>
  );
}
