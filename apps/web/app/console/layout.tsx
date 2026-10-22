"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { planHas, ROLE_LABELS, type Feature, type Plan } from "@playcode/core";
import { AuthGate, signOut, switchTenant, useMe } from "@/components/Auth";
import { Icon } from "@/components/Icon";
import { logoSrc } from "@/lib/branding";

type NavItem = { href: string; label: string; icon: string; perm: string | string[] | null; feature?: Feature; tenantOnly?: boolean; superAdmin?: boolean };

const NAV: NavItem[] = [
  { href: "/console", label: "Overview", icon: "chart", perm: null },
  { href: "/console/students", label: "Students", icon: "users", perm: null },
  { href: "/console/assignments", label: "Assignments", icon: "clipboard", perm: "assignments.manage" },
  { href: "/console/paths", label: "Learning paths", icon: "map", perm: "assignments.manage", feature: "learning_paths" },
  { href: "/console/tests", label: "Tests", icon: "flag", perm: "assessments.proctor" },
  { href: "/console/placements", label: "Placements", icon: "briefcase", perm: "placements.manage", feature: "placements" },
  { href: "/console/drives", label: "Hiring drives", icon: "users", perm: "drives.manage", feature: "hiring_drives" },
  { href: "/console/engage", label: "Engagement", icon: "megaphone", perm: null },
  { href: "/console/batches", label: "Batches", icon: "layers", perm: null },
  { href: "/console/reports", label: "Reports", icon: "chart", perm: ["analytics.institution", "analytics.department", "analytics.own_units"] },
  { href: "/console/content", label: "Question bank", icon: "book", perm: "content.view" },
  { href: "/console/studio", label: "Content studio", icon: "spark", perm: ["content.private.manage", "content.global.manage"], feature: "content_studio" },
  { href: "/console/integrations", label: "Integrations", icon: "layers", perm: "api.manage", feature: "api" },
  { href: "/console/privacy", label: "Privacy requests", icon: "shield", perm: "users.manage" },
  { href: "/console/audit", label: "Audit log", icon: "list", perm: "audit.view" },
  { href: "/console/settings", label: "Settings", icon: "settings", perm: "tenant.settings" },
  { href: "/console/billing", label: "Plan & billing", icon: "clipboard", perm: "tenant.settings", tenantOnly: true },
  { href: "/console/billing", label: "Invoicing", icon: "clipboard", perm: null, superAdmin: true },
];

/** Hide what the role can't use, and what the institution's plan doesn't include (PlayCode staff outside an institution see everything). */
function visible(n: NavItem, me: { permissions: string[]; user: { roles: string[] }; tenant: { plan: string } | null }) {
  if (n.superAdmin) return me.user.roles.includes("super_admin") && !me.tenant;
  if (n.tenantOnly && !me.tenant) return false;
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
    <div className="spread" style={{ background: "var(--warn-soft)", color: "var(--warn)", padding: "8px 16px", borderRadius: 10, marginBottom: 16, fontWeight: 600 }}>
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
          {children}
        </main>
      </div>
    </AuthGate>
  );
}
