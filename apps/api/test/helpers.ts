import type { FastifyInstance } from "fastify";
import { QUESTIONS } from "../src/content/questions";
import { buildApp } from "../src/app";
import { resetDatabase } from "../src/db/reset";
import { DEMO_PASSWORD, seedDemo } from "../src/db/seed";
import type { Answer, StudentResponse } from "@playcode/core";

export const START = new Date("2026-10-22T06:30:00Z"); // Thursday, noon in India

export interface TestApp {
  app: FastifyInstance;
  clock: { now: Date };
  login: (email: string, password?: string) => Promise<string>;
  get: (token: string, url: string) => Promise<{ status: number; body: any }>;
  post: (token: string, url: string, payload?: unknown) => Promise<{ status: number; body: any }>;
}

export async function setup(): Promise<TestApp> {
  await resetDatabase();
  await seedDemo(START);
  const clock = { now: new Date(START) };
  const app = await buildApp({ now: () => clock.now });
  const call = async (method: "GET" | "POST", token: string, url: string, payload?: unknown) => {
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
  };
}

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

export function rightAnswer(questionId: string): StudentResponse {
  const a: Answer = byId.get(questionId)!.answer;
  if (a.kind === "option") return { kind: "option", optionId: a.optionId };
  if (a.kind === "text") return { kind: "text", value: a.accepted[0]! };
  if (a.kind === "lines") return { kind: "lines", lines: a.lines };
  return { kind: "order", ids: a.orders[0]! };
}

export function wrongAnswer(questionId: string): StudentResponse {
  const q = byId.get(questionId)!;
  const a = q.answer;
  if (a.kind === "option") return { kind: "option", optionId: q.body.options!.find((o) => o.id !== a.optionId)!.id };
  if (a.kind === "text") return { kind: "text", value: "definitely wrong" };
  if (a.kind === "lines") return { kind: "lines", lines: [a.lines[0] === 1 ? 2 : 1] };
  return { kind: "order", ids: [...a.orders[0]!].reverse() };
}
