import { describe, expect, it } from "vitest";
import { ONLINE_WINDOW_MS, isOnline } from "./presence.js";

describe("isOnline", () => {
  const now = Date.parse("2026-09-19T03:00:00Z");
  it("最近アプリを開いていればオンライン", () => {
    expect(isOnline(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(isOnline(new Date(now - ONLINE_WINDOW_MS).toISOString(), now)).toBe(true);
  });
  it("しばらく開いていなければオフライン", () => {
    expect(isOnline(new Date(now - ONLINE_WINDOW_MS - 1000).toISOString(), now)).toBe(false);
  });
  it("記録がない・壊れた値はオフライン", () => {
    expect(isOnline(undefined, now)).toBe(false);
    expect(isOnline("nonsense", now)).toBe(false);
  });
  it("未来の時刻はオフライン扱い（端末の時計ずれ対策）", () => {
    expect(isOnline(new Date(now + 60_000).toISOString(), now)).toBe(false);
  });
});