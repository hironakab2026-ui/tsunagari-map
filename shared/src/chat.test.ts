import { describe, expect, it } from "vitest";
import { threadIdOf } from "./chat.js";

describe("threadIdOf", () => {
  it("相手の順序によらず同じ会話になる", () => {
    expect(threadIdOf("u01", "u02")).toBe(threadIdOf("u02", "u01"));
  });
  it("違う相手なら違う会話になる", () => {
    expect(threadIdOf("u01", "u02")).not.toBe(threadIdOf("u01", "u03"));
  });
});