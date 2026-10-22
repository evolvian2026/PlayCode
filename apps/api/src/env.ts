import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://playcode:playcode@localhost:5432/playcode"),
  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-please"),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  NODE_ENV: z.string().default("development"),
  EXECUTION_BACKEND: z.enum(["local", "judge0"]).default("local"),
  EXECUTION_ALLOW_LOCAL: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  EXECUTION_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  JUDGE0_URL: z.string().url().optional(),
  JUDGE0_TOKEN: z.string().optional(),
  JUDGE0_LANGUAGE_IDS: z.string().optional(),
  /** Local folder for uploaded files (proctoring snapshots). Swap for object storage in production. */
  STORAGE_DIR: z.string().default(".storage"),
  /** WhatsApp Cloud API. Without these, nudges are in-app only. */
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_ID: z.string().optional(),
  WHATSAPP_TEMPLATE_LANG: z.string().default("en"),
  PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
});

export const env = schema.parse(process.env);

if (env.NODE_ENV === "production" && env.JWT_SECRET === "dev-only-secret-change-me-please") {
  throw new Error("Set JWT_SECRET in production");
}
