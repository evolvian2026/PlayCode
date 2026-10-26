import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, type TestApp } from "./helpers";

let t: TestApp;

beforeAll(async () => {
  t = await setup();
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("display settings", () => {
  it("saves them to the account, merging changes", async () => {
    const riya = await t.login("student@demo.edu");
    expect((await t.get(riya, "/me")).body.user.display).toEqual({});
    expect((await t.put(riya, "/me/display", { textSize: "large", reduceMotion: true })).body.display).toEqual({ textSize: "large", reduceMotion: true });
    expect((await t.put(riya, "/me/display", { readableFont: true })).body.display).toEqual({ textSize: "large", reduceMotion: true, readableFont: true });
    expect((await t.get(riya, "/me")).body.user.display).toEqual({ textSize: "large", reduceMotion: true, readableFont: true });
    // A fresh sign-in (another phone) gets the same settings.
    expect((await t.get(await t.login("student@demo.edu"), "/me")).body.user.display.textSize).toBe("large");
  });

  it("rejects unknown sizes and settings, and works for staff", async () => {
    const tpo = await t.login("tpo@demo.edu");
    expect((await t.put(tpo, "/me/display", { textSize: "huge" })).status).toBe(400);
    expect((await t.put(tpo, "/me/display", { theme: "pink" })).status).toBe(400);
    expect((await t.put(tpo, "/me/display", { highContrast: true })).body.display).toEqual({ highContrast: true });
    expect((await t.put("", "/me/display", { highContrast: true })).status).toBe(401);
  });
});
