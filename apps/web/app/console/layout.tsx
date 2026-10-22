"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ROLE_LABELS } from "@playcode/core";
import { AuthGate, signOut, switchTenant, useMe } from "@/components/Auth";
import { Icon } from "@/components/Icon";
import { logoSrc } from "@/lib/branding";

const NAV = [
  { href: "/console", label: "Overview", icon: "chart", perm: null },
  { href: "/console/students", label: "Students", icon: "users", perm: null },
  { href: "/console/assignments", label: "Assignments", icon: "clipboard", perm: "assignments.manage" },
  { href: "/console/tests", label: "Tests", icon: "flag", perm: "assessments.proctor" },
  { href: "/console/drives", label: "Hiring drives", icon: "users", perm: "drives.manage" },
  { href: "/console/engage", label: "Engagement", icon: "megaphone", perm: null },
  { href: "/console/batches", label: "Batches", icon: "layers", perm: null },
  { href: "/console/content", label: "Question bank", icon: "book", perm: "content.view" },
  { href: "/console/integrations", label: "Integrations", icon: "layers", perm: "api.manage" },
  { href: "/console/settings", label: "Settings", icon: "settings", perm: "tenant.settings" },
];

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
      {NAV.filter((n) => !n.perm || me.permissions.includes(n.perm)).map((n) => {
        const active = n.href === "/console" ? path === "/console" : path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <span className="row" style={{ gap: 10 }}>
              <Icon name={n.icon} size={18} /> {n.label}
            </span>
          </Link>
        );
      })}
      <div style={{ marginTop: "auto", padding: "16px 12px 0" }} className="small">
        <div style={{ fontWeight: 600 }}>{me.user.name}</div>
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
