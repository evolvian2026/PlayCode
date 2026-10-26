import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GD_MAX_CONTRIBUTIONS } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { aiUsage } from "../src/db/schema";
import { setAiProvider, type AiProvider, type GdInput } from "../src/lib/ai";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const turns: GdInput[] = [];
const scored: (GdInput & { participation: unknown })[] = [];
const usage = { inputTokens: 300, outputTokens: 80, cacheReadTokens: 0 };
const notUsed = async () => {
  throw new Error("not used");
};
const fake: AiProvider = {
  coachHint: notUsed,
  draftQuestions: notUsed,
  draftCodingProblems: notUsed,
  draftSqlProblems: notUsed,
  reviewSnapshot: notUsed,
  interviewTurn: notUsed,
  interviewScorecard: notUsed,
  weeklyInsights: notUsed,
  reviewCode: notUsed,
  writingFeedback: notUsed,
  async gdTurn(input) {
    turns.push(input);
    return {
      value: {
        messages: [
          { speaker: "ananya", text: "Surveys from Nasscom show productivity held up." },
          { speaker: "nobody" as "rohit", text: "An unknown speaker is dropped." },
          { speaker: "rohit", text: "But juniors learn less without seniors around, Riya." },
          { speaker: "meera", text: "Both good points. Could hybrid be the middle ground?" },
          { speaker: "ananya", text: "A fourth message is one too many for a round." },
        ],
      },
      usage,
    };
  },
  async gdScorecard(input) {
    scored.push(input);
    return {
      value: {
        scores: { content: 4, communication: 3, listening: 4, leadership: 9, summary: 4 },
        overall: 4,
        strengths: ["You answered Rohit's point on juniors with the mentoring example."],
        improvements: ["Open the discussion: you waited for others."],
        summary: "You listened well and added facts.",
        missedPoints: ["Office space costs", "Women's participation in the workforce", "Small-town hiring", "A fourth"],
      },
      usage,
    };
  },
};

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  setAiProvider(fake);
});

afterAll(async () => {
  setAiProvider(undefined);
  await t.app.close();
  await pool.end();
});

describe("group discussion practice", () => {
  let id: string;

  it("opens with the moderator, on a topic the student hasn't done", async () => {
    const list = (await t.get(riya, "/student/gd")).body;
    expect(list).toMatchObject({ available: true, weeklyLeft: 3, active: null });
    const gd = (await t.post(riya, "/student/gd", { topicId: "wfh" })).body;
    id = gd.id;
    expect(gd).toMatchObject({ topic: { id: "wfh", title: "Work from home is here to stay" }, status: "active", phase: "discussion", contributionsLeft: GD_MAX_CONTRIBUTIONS });
    expect(gd.turns).toEqual([expect.objectContaining({ speaker: "moderator", name: "Moderator", text: expect.stringContaining("Work from home") })]);
    // Starting again returns the one in progress.
    expect((await t.post(riya, "/student/gd", {})).body.id).toBe(id);
    expect(turns).toHaveLength(0); // the opening costs nothing
  });

  it("lets the student speak or listen, and the others reply", async () => {
    const spoke = (await t.post(riya, `/student/gd/${id}/speak`, { text: "I think work from home saves hours of commuting in cities like Bengaluru." })).body;
    expect(turns[0]).toMatchObject({ cue: "spoke", studentName: "Riya", topic: "Work from home is here to stay" });
    expect(turns[0]!.turns.at(-1)).toEqual({ name: "Riya", text: expect.stringContaining("commuting") });
    // Unknown speakers are dropped, and at most three reply per round.
    expect(spoke.turns.slice(2).map((x: { name: string }) => x.name)).toEqual(["Ananya", "Rohit", "Meera"]);
    expect(spoke).toMatchObject({ contributionsLeft: GD_MAX_CONTRIBUTIONS - 1, roundsLeft: 9 });

    const listened = (await t.post(riya, `/student/gd/${id}/listen`)).body;
    expect(turns[1]).toMatchObject({ cue: "listening" });
    expect(listened).toMatchObject({ contributionsLeft: GD_MAX_CONTRIBUTIONS - 1, roundsLeft: 8 });
    expect((await t.post(riya, `/student/gd/${id}/speak`, { text: "x" })).status).toBe(400);
  });

  it("asks for a summary once the student's turns run out, and scores the summary", async () => {
    let gd;
    for (let i = 1; i < GD_MAX_CONTRIBUTIONS; i++) gd = (await t.post(riya, `/student/gd/${id}/speak`, { text: `Point ${i}: mentoring can happen online too, Rohit.` })).body;
    expect(gd).toMatchObject({ phase: "summary", contributionsLeft: 0 });
    expect(gd.turns.at(-1)).toMatchObject({ speaker: "moderator", text: expect.stringContaining("sum up") });
    expect((await t.post(riya, `/student/gd/${id}/listen`)).body.error.code).toBe("gd_summary");

    const done = (await t.post(riya, `/student/gd/${id}/speak`, { text: "To sum up, we agreed remote work saves time, but juniors need mentoring, so hybrid may work best." })).body;
    expect(done.status).toBe("finished");
    expect(done.turns.at(-1)).toMatchObject({ speaker: "moderator", text: "Thank you, everyone. That's time." });
    expect(done.scorecard).toMatchObject({
      scores: { content: 4, leadership: 5, summary: 4 }, // clamped to 5
      overall: 4,
      missedPoints: expect.any(Array),
      participation: { contributions: GD_MAX_CONTRIBUTIONS, initiated: true, summarised: true },
    });
    expect(done.scorecard.missedPoints).toHaveLength(3);
    expect(scored[0]!.participation).toMatchObject({ contributions: 6, summarised: true });
    const used = (await db.select().from(aiUsage)).filter((u) => u.feature === "group_discussion");
    expect(used.length).toBe(turns.length + 1);
  });

  it("scores a summary that was never given as 1, and sets aside a GD with too little said", async () => {
    const gd = (await t.post(riya, "/student/gd", {})).body;
    expect(gd.topic.id).not.toBe("wfh");
    await t.post(riya, `/student/gd/${gd.id}/listen`);
    await t.post(riya, `/student/gd/${gd.id}/speak`, { text: "Startups teach you more in a year than an MNC does in three." });
    await t.post(riya, `/student/gd/${gd.id}/speak`, { text: "But an MNC gives structured training, Ananya, which freshers need." });
    expect((await t.post(riya, `/student/gd/${gd.id}/wrap`)).body.phase).toBe("summary");
    const done = (await t.post(riya, `/student/gd/${gd.id}/finish`)).body;
    expect(done.scorecard.scores.summary).toBe(1);
    expect(done.scorecard.participation).toMatchObject({ contributions: 2, initiated: false, summarised: false });

    const short = (await t.post(riya, "/student/gd", {})).body;
    await t.post(riya, `/student/gd/${short.id}/speak`, { text: "I'll keep it short." });
    expect((await t.post(riya, `/student/gd/${short.id}/finish`)).body).toMatchObject({ status: "abandoned", scorecard: null });
  });

  it("limits GDs to three a week", async () => {
    expect((await t.get(riya, "/student/gd")).body.weeklyLeft).toBe(0);
    expect((await t.post(riya, "/student/gd", {})).status).toBe(400);
  });

  it("shows scored GDs to the student's teachers only", async () => {
    const faculty = await t.login("faculty@demo.edu");
    const list = (await t.get(faculty, "/console/gd")).body;
    expect(list.discussions).toHaveLength(2);
    expect(list.averages).toMatchObject({ count: 2, overall: 4 });
    const detail = (await t.get(faculty, `/console/gd/${id}`)).body;
    expect(detail).toMatchObject({ student: { name: "Riya Kapoor" }, status: "finished" });
    expect((await t.get(await t.login("admin@sunrise.edu"), `/console/gd/${id}`)).status).toBe(404);
    expect((await t.get(riya, "/console/gd")).status).toBe(403);
  });

  it("reports itself unavailable without AI", async () => {
    setAiProvider(null);
    expect((await t.get(riya, "/student/gd")).body).toMatchObject({ available: false, reason: expect.stringContaining("not switched on") });
    setAiProvider(fake);
  });
});
