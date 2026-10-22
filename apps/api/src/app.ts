import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { db } from "./db/client";
import { users } from "./db/schema";
import { env } from "./env";
import { verifyToken } from "./lib/auth";
import { HttpError } from "./lib/errors";
import { startFanout, stopFanout, subscribe } from "./lib/realtime";
import { adminRoutes } from "./routes/admin";
import { assessmentConsoleRoutes } from "./routes/assessments-console";
import { authRoutes } from "./routes/auth";
import { billingRoutes } from "./routes/billing";
import { consoleRoutes } from "./routes/console";
import { developerRoutes } from "./routes/developers";
import { driveRoutes } from "./routes/drives";
import { ltiRoutes } from "./routes/lti";
import { pathRoutes } from "./routes/paths";
import { privacyRoutes } from "./routes/privacy";
import { reportRoutes } from "./routes/reports";
import { samlRoutes } from "./routes/saml";
import { studioRoutes } from "./routes/studio";
import { engageRoutes } from "./routes/engage";
import { publicRoutes } from "./routes/public";
import { studentRoutes } from "./routes/student";
import { v1Routes } from "./routes/v1";

export interface AppOptions {
  /** Injectable clock, so tests can move time. */
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? {
          serializers: {
            // The WebSocket token travels in the query string; keep it out of logs.
            req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.replace(/token=[^&]+/, "token=[redacted]") }),
          },
        }
      : false,
  });
  app.decorate("now", options.now ?? (() => new Date()));
  await app.register(cors, { origin: env.CORS_ORIGIN.split(","), credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });

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

  // Live events (duels, proctoring). Browsers cannot set headers on a
  // WebSocket, so the token comes as a query parameter.
  await app.register(websocket);
  if (env.REALTIME_FANOUT === "postgres") {
    await startFanout();
    app.addHook("onClose", async () => stopFanout());
  }
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    let userId: string;
    try {
      userId = (await verifyToken(token ?? "")).sub;
      const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));
      if (u?.status !== "active") throw new Error("inactive");
    } catch {
      socket.close(4401, "unauthorized");
      return;
    }
    const unsubscribe = subscribe(userId, socket);
    const ping = setInterval(() => socket.ping(), 25_000);
    socket.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
    socket.send(JSON.stringify({ type: "hello" }));
  });
  await app.register(publicRoutes);
  await app.register(authRoutes);
  await app.register(studentRoutes, { prefix: "/student" });
  await app.register(consoleRoutes, { prefix: "/console" });
  await app.register(assessmentConsoleRoutes, { prefix: "/console" });
  await app.register(adminRoutes, { prefix: "/admin" });
  await app.register(engageRoutes);
  await app.register(developerRoutes, { prefix: "/console" });
  await app.register(v1Routes);
  await app.register(driveRoutes);
  await app.register(privacyRoutes);
  await app.register(studioRoutes, { prefix: "/console" });
  await app.register(ltiRoutes);
  await app.register(pathRoutes);
  await app.register(reportRoutes);
  await app.register(samlRoutes);
  await app.register(billingRoutes);
  return app;
}
