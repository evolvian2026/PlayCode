import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { db } from "./db/client";
import { users } from "./db/schema";
import { env } from "./env";
import { verifyToken } from "./lib/auth";
import { HttpError } from "./lib/errors";
import { safeEqual, sha256 } from "./lib/crypto";
import { observeRequest, renderMetrics } from "./lib/metrics";
import { readiness, systemGauges } from "./services/system";
import { closeQueueListener } from "./execution/job-queue";
import { startFanout, stopFanout, subscribe } from "./lib/realtime";
import { accountRoutes } from "./routes/account";
import { adminRoutes } from "./routes/admin";
import { assessmentConsoleRoutes } from "./routes/assessments-console";
import { authRoutes } from "./routes/auth";
import { billingRoutes } from "./routes/billing";
import { consoleRoutes } from "./routes/console";
import { developerRoutes } from "./routes/developers";
import { driveRoutes } from "./routes/drives";
import { classTestRoutes } from "./routes/class-tests";
import { calendarFeedRoutes, calendarStudentRoutes } from "./routes/calendar";
import { gdRoutes } from "./routes/gd";
import { mentoringConsoleRoutes, mentoringStudentRoutes } from "./routes/mentoring";
import { trainingConsoleRoutes, trainingStudentRoutes } from "./routes/training";
import { guardianConsoleRoutes, guardianPublicRoutes, guardianStudentRoutes } from "./routes/guardians";
import { circularConsoleRoutes, circularStudentRoutes } from "./routes/circulars";
import { documentConsoleRoutes, documentStudentRoutes } from "./routes/documents";
import { staffCalendarRoutes } from "./routes/staff-calendar";
import { paperRoutes } from "./routes/papers";
import { writingRoutes } from "./routes/writing";
import { interviewRoutes } from "./routes/interviews";
import { ltiRoutes } from "./routes/lti";
import { resumeRoutes } from "./routes/resume";
import { talentRoutes } from "./routes/talent";
import { contestRoutes } from "./routes/contests";
import { planRoutes } from "./routes/plan";
import { liveQuizRoutes } from "./routes/live-quiz";
import { scimConsoleRoutes, scimRoutes } from "./routes/scim";
import { mockRoutes } from "./routes/mocks";
import { offlineRoutes } from "./routes/offline";
import { squadRoutes } from "./routes/squads";
import { doubtRoutes } from "./routes/doubts";
import { interviewSlotRoutes } from "./routes/interview-slots";
import { pathRoutes } from "./routes/paths";
import { placementRoutes } from "./routes/placements";
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
    // A request id from the load balancer is kept (if it looks like one); otherwise we make one. It is logged and returned in x-request-id.
    requestIdHeader: false,
    genReqId: (req) => {
      const given = req.headers["x-request-id"];
      return typeof given === "string" && /^[\w.:-]{8,100}$/.test(given) ? given : randomUUID();
    },
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
    return reply.status(500).send({ error: { code: "internal", message: `Something went wrong. If it keeps happening, quote reference ${req.id}.`, requestId: req.id } });
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
    // The API serves JSON, files and redirects, never pages: nothing may run or be framed from it.
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    if (env.NODE_ENV === "production") reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    // Responses for a signed-in user are never cached by browsers or proxies.
    if (req.headers.authorization && !reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
  });
  app.addHook("onResponse", async (req, reply) => {
    observeRequest(req.method, req.routeOptions.url ?? "unmatched", reply.statusCode, reply.elapsedTime / 1000);
  });

  // Liveness: the process is up. Readiness: it can reach the database, which is fully migrated.
  app.get("/health", async () => ({ ok: true }));
  app.get("/health/ready", async (_req, reply) => {
    const r = await readiness(db);
    return reply.status(r.ready ? 200 : 503).send(r);
  });

  // Prometheus metrics, only when METRICS_TOKEN is set; scrapers send it as a bearer token.
  app.get("/metrics", async (req, reply) => {
    const token = process.env.METRICS_TOKEN;
    if (!token) return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
    const sent = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!safeEqual(sha256(sent), sha256(token))) return reply.status(401).send({ error: { code: "unauthorized", message: "Bad metrics token" } });
    return reply.header("content-type", "text/plain; version=0.0.4").send(renderMetrics(await systemGauges(db, app.now())));
  });

  app.addHook("onClose", async () => closeQueueListener());

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
  await app.register(paperRoutes, { prefix: "/console" });
  await app.register(trainingConsoleRoutes, { prefix: "/console" });
  await app.register(mentoringConsoleRoutes, { prefix: "/console" });
  await app.register(guardianConsoleRoutes, { prefix: "/console" });
  await app.register(circularConsoleRoutes, { prefix: "/console" });
  await app.register(documentConsoleRoutes, { prefix: "/console" });
  await app.register(staffCalendarRoutes, { prefix: "/console" });
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
  await app.register(accountRoutes);
  await app.register(placementRoutes);
  await app.register(interviewRoutes);
  await app.register(gdRoutes);
  await app.register(classTestRoutes);
  await app.register(calendarStudentRoutes);
  await app.register(calendarFeedRoutes);
  await app.register(mentoringStudentRoutes);
  await app.register(trainingStudentRoutes);
  await app.register(guardianStudentRoutes);
  await app.register(guardianPublicRoutes);
  await app.register(circularStudentRoutes);
  await app.register(documentStudentRoutes);
  await app.register(writingRoutes);
  await app.register(resumeRoutes);
  await app.register(talentRoutes);
  await app.register(contestRoutes);
  await app.register(planRoutes);
  await app.register(liveQuizRoutes);
  await app.register(scimRoutes);
  await app.register(mockRoutes);
  await app.register(offlineRoutes);
  await app.register(squadRoutes);
  await app.register(doubtRoutes);
  await app.register(interviewSlotRoutes);
  await app.register(scimConsoleRoutes, { prefix: "/console" });
  return app;
}
