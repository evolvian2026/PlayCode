import { ELIGIBILITY_REASON_TEMPLATES as TEMPLATES } from "@playcode/core";
import type { Translate } from "./i18n";

// Why a student can't register for a drive. The reasons are built as
// English sentences in @playcode/core (and the API and its tests rely on
// them as they are), so they're translated here: each is matched against the
// English template it was made from (listed beside the code that builds
// them), and the template is translated with the values put back in.

const PATTERNS = TEMPLATES.map((template) => {
  const names = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  const source = template
    .split(/\{\w+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("(.+?)");
  return { template, names, re: new RegExp(`^${source}$`) };
});

/** A drive eligibility reason in the student's language; one not recognised stays as it came. */
export function translateReason(reason: string, t: Translate): string {
  for (const p of PATTERNS) {
    const m = reason.match(p.re);
    if (m) return t(p.template, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]!])));
  }
  return reason;
}

