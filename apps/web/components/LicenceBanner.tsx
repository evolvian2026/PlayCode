"use client";

import { useMe } from "@/components/Auth";
import { useT } from "@/lib/i18n";

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Licence warnings. Admins see the renewal reminder before the end date;
 * everyone sees the grace-period warning and the read-only notice.
 */
export function LicenceBanner({ area }: { area: "console" | "play" }) {
  const me = useMe();
  const t = useT();
  const l = me.licence;
  if (!l || l.state === "active" || !l.validUntil) return null;
  const admin = me.permissions.includes("tenant.settings");
  if (l.state === "ending" && !(area === "console" && admin)) return null;
  const tone = l.state === "expired" ? "var(--bad-soft)" : "var(--warn-soft)";
  let text: string;
  if (area === "console") {
    text =
      l.state === "ending"
        ? `Your PlayCode licence ends on ${fmt(l.validUntil)} (${l.daysLeft} days). Renew to keep students practising without a break.`
        : l.state === "grace"
          ? `Your PlayCode licence ended on ${fmt(l.validUntil)}. Everything keeps working until ${fmt(l.graceEndsOn!)}; after that the account becomes read-only until it is renewed.`
          : `Your PlayCode licence ended on ${fmt(l.validUntil)}. The account is read-only: people can sign in, view and export their data, but nothing new can be practised or created until it is renewed.`;
  } else {
    text =
      l.state === "grace"
        ? t("Your institution's PlayCode licence has ended. Practice keeps working until {date}.", { date: fmt(l.graceEndsOn!) })
        : t("Your institution's PlayCode licence has ended. You can still see your progress, but practice is paused until it is renewed.");
  }
  return (
    <div role="status" className="card tight small" style={{ background: tone, borderColor: "transparent", marginBottom: 12 }}>
      {text}
      {area === "console" && admin && (
        <>
          {" "}
          <a href="/console/billing">Plan &amp; billing</a>
        </>
      )}
    </div>
  );
}
