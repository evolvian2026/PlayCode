// Commercial plans: what each includes and what it costs. Prices are in
// paise (1 rupee = 100 paise) per seat per month, billed monthly; GST is added
// on the invoice. AI use is metered in tokens with a monthly allowance.

export const PLANS = ["starter", "pro", "enterprise"] as const;
export type Plan = (typeof PLANS)[number];

export const FEATURES = [
  "proctoring_camera",
  "ai_proctoring",
  "content_studio",
  "ai_drafting",
  "ai_coach",
  "learning_paths",
  "reports_email",
  "sso",
  "saml",
  "lti",
  "api",
  "white_label",
  "whatsapp",
  "hiring_drives",
] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  proctoring_camera: "Camera proctoring",
  ai_proctoring: "AI photo checks in tests",
  content_studio: "Content studio (own questions)",
  ai_drafting: "AI question drafting",
  ai_coach: "AI coach for students",
  learning_paths: "Learning paths",
  reports_email: "Weekly report emails",
  sso: "Google / Microsoft sign-in",
  saml: "SAML sign-in",
  lti: "LMS integration (LTI 1.3)",
  api: "Public API and webhooks",
  white_label: "Your own branding",
  whatsapp: "WhatsApp reminders",
  hiring_drives: "Hiring drives",
};

export interface PlanSpec {
  name: string;
  features: readonly Feature[];
  /** Price per seat per month, in paise. */
  seatPricePaise: number;
  /** AI tokens (input + output) included per month. */
  aiTokensPerMonth: number;
  /** Price per million AI tokens beyond the allowance, in paise (0: AI stops at the allowance). */
  aiOveragePerMillionPaise: number;
}

const PRO: Feature[] = ["proctoring_camera", "content_studio", "ai_coach", "learning_paths", "reports_email", "sso", "white_label", "whatsapp", "hiring_drives"];

export const PLAN_SPECS: Record<Plan, PlanSpec> = {
  starter: { name: "Starter", features: [], seatPricePaise: 2_500, aiTokensPerMonth: 0, aiOveragePerMillionPaise: 0 },
  pro: { name: "Pro", features: PRO, seatPricePaise: 6_000, aiTokensPerMonth: 2_000_000, aiOveragePerMillionPaise: 0 },
  enterprise: {
    name: "Enterprise",
    features: [...PRO, "ai_proctoring", "ai_drafting", "saml", "lti", "api"],
    seatPricePaise: 12_000,
    aiTokensPerMonth: 10_000_000,
    aiOveragePerMillionPaise: 40_000,
  },
};

export function planHas(plan: Plan, feature: Feature): boolean {
  return PLAN_SPECS[plan].features.includes(feature);
}

/** The cheapest plan that includes a feature, for "upgrade to ..." messages. */
export function planFor(feature: Feature): Plan {
  return PLANS.find((p) => planHas(p, feature)) ?? "enterprise";
}

/** "₹1,23,456.78" in the Indian numbering system. */
export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface TaxSplit {
  cgst: number;
  sgst: number;
  igst: number;
}

/** 18% GST: CGST + SGST within the supplier's state, IGST across states. Amounts in paise. */
export function gstSplit(taxablePaise: number, supplierState: string, customerState: string | null): TaxSplit {
  const total = Math.round(taxablePaise * 0.18);
  if (customerState && customerState === supplierState) {
    const half = Math.round(total / 2);
    return { cgst: half, sgst: total - half, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: total };
}
