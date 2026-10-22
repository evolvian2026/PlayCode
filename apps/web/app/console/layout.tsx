"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ROLE_LABELS } from "@playcode/core";
import { AuthGate, signOut, useMe } from "@/components/Auth";
import { Icon } from "@/components/Icon";

const NAV = [
  { href: "/console", label: "Overview", icon: "chart", perm: null },
  { href: "/console/students", label: "Students", icon: "users", perm: null },
  { href: "/console/assignments", label: "Assignments", icon: "clipboard", perm: "assignments.manage" },
  { href: "/console/tests", label: "Tests", icon: "flag", perm: "assessments.proctor" },
  { href: "/console/batches", label: "Batches", icon: "layers", perm: null },
  { href: "/console/content", label: "Question bank", icon: "book", perm: "content.view" },
];

function Side() {
  const me = useMe();
  const path = usePathname();
  return (
    <nav className="console-side" aria-label="Console">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        PlayCode
      </div>
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

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate area="console">
      <div className="console-shell">
        <Side />
        <main className="console-main">{children}</main>
      </div>
    </AuthGate>
  );
}
