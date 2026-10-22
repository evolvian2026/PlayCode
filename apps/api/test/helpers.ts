import type { FastifyInstance } from "fastify";
import { ALL_QUESTIONS as QUESTIONS } from "../src/content";
import { correctResponse, wrongResponse } from "../src/content/responses";
import { buildApp } from "../src/app";
import { resetRateLimits } from "../src/lib/rate-limit";
import { resetDatabase } from "../src/db/reset";
import { DEMO_PASSWORD, seedDemo } from "../src/db/seed";
import type { StudentResponse } from "@playcode/core";

export const START = new Date("2026-10-22T06:30:00Z"); // Thursday, noon in India

export interface TestApp {
  app: FastifyInstance;
  clock: { now: Date };
  login: (email: string, password?: string) => Promise<string>;
  get: (token: string, url: string) => Promise<{ status: number; body: any }>;
  post: (token: string, url: string, payload?: unknown) => Promise<{ status: number; body: any }>;
  put: (token: string, url: string, payload?: unknown) => Promise<{ status: number; body: any }>;
}

export async function setup(): Promise<TestApp> {
  resetRateLimits();
  await resetDatabase();
  await seedDemo(START);
  const clock = { now: new Date(START) };
  const app = await buildApp({ now: () => clock.now });
  const call = async (method: "GET" | "POST" | "PUT", token: string, url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as never, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.statusCode, body: res.json() };
  };
  return {
    app,
    clock,
    login: async (email, password = DEMO_PASSWORD) => {
      const res = await call("POST", "", "/auth/login", { email, password });
      if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
      return res.body.token as string;
    },
    get: (token, url) => call("GET", token, url),
    post: (token, url, payload) => call("POST", token, url, payload),
    put: (token, url, payload) => call("PUT", token, url, payload),
  };
}

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

export const rightAnswer = (questionId: string): StudentResponse => correctResponse(byId.get(questionId)!);
export const wrongAnswer = (questionId: string): StudentResponse => wrongResponse(byId.get(questionId)!);
