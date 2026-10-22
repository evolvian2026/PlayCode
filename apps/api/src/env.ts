import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://playcode:playcode@localhost:5432/playcode"),
  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-please"),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  NODE_ENV: z.string().default("development"),
});

export const env = schema.parse(process.env);

if (env.NODE_ENV === "production" && env.JWT_SECRET === "dev-only-secret-change-me-please") {
  throw new Error("Set JWT_SECRET in production");
}
