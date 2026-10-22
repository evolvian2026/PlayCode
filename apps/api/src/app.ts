import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./env";
import { HttpError } from "./lib/errors";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { consoleRoutes } from "./routes/console";
import { studentRoutes } from "./routes/student";

export interface AppOptions {
  /** Injectable clock, so tests can move time. */
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  app.decorate("now", options.now ?? (() => new Date()));
  await app.register(cors, { origin: env.CORS_ORIGIN.split(","), credentials: true });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const { statusCode, message } = err as { statusCode?: number; message?: string };
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: { code: "bad_request", message: message ?? "Bad request" } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong" } });
  });

  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(studentRoutes, { prefix: "/student" });
  await app.register(consoleRoutes, { prefix: "/console" });
  await app.register(adminRoutes, { prefix: "/admin" });
  return app;
}
