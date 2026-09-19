import { describe, expect, it } from "vitest";
import { buildSeatsFromConfig, drawSeat } from "./lottery.js";
import { routeKaizen } from "./routing.js";
import { detectPii } from "./pii.js";
import type { Seat } from "./types.js";

describe("buildSeatsFromConfig", () => {
  it("グループ席から若い番号を振り、その後にプライベート席を続ける", () => {
    const seats = buildSeatsFromConfig("hq", "2F", { groups: [{ capacity: 4, count: 2 }], privateCount: 3 });
    expect(seats).toHaveLength(5);
    expect(seats.filter((s) => s.kind === "group").map((s) => s.number)).toEqual([1, 2]);
    expect(seats.filter((s) => s.kind === "private").map((s) => s.number)).toEqual([3, 4, 5]);
    expect(seats.find((s) => s.kind === "group")!.capacity).toBe(4);
    expect(seats.find((s) => s.kind === "private")!.capacity).toBe(1);
  });
});

describe("drawSeat", () => {
  const seats: Seat[] = buildSeatsFromConfig("hq", "2F", { groups: [{ capacity: 4, count: 2 }], privateCount: 2 });

  it("グループ席に空きがあればグループ席から選ぶ", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = drawSeat({ seats, occupancy: {}, personId: "u1", seed });
      const seat = seats.find((s) => s.id === r!.seatId)!;
      expect(seat.kind).toBe("group");
    }
  });

  it("グループ席が満席ならプライベート席から選ぶ", () => {
    const occupancy: Record<string, string[]> = {};
    for (const s of seats.filter((x) => x.kind === "group")) occupancy[s.id] = Array.from({ length: s.capacity }, (_, i) => `filled-${s.id}-${i}`);
    const r = drawSeat({ seats, occupancy, personId: "u1", seed: 1 });
    const seat = seats.find((s) => s.id === r!.seatId)!;
    expect(seat.kind).toBe("private");
  });

  it("空きが1つもなければ null を返す", () => {
    const occupancy: Record<string, string[]> = {};
    for (const s of seats) occupancy[s.id] = Array.from({ length: s.capacity }, (_, i) => `filled-${s.id}-${i}`);
    expect(drawSeat({ seats, occupancy, personId: "u1", seed: 1 })).toBeNull();
  });

  it("同じシードなら同じ結果になる", () => {
    const a = drawSeat({ seats, occupancy: {}, personId: "u1", seed: 42 });
    const b = drawSeat({ seats, occupancy: {}, personId: "u1", seed: 42 });
    expect(a).toEqual(b);
  });

  it("既に自分が座っている席は選ばない", () => {
    const groupSeats = seats.filter((s) => s.kind === "group");
    const occupancy: Record<string, string[]> = { [groupSeats[0].id]: ["u1"] };
    for (let seed = 1; seed <= 10; seed++) {
      const r = drawSeat({ seats, occupancy, personId: "u1", seed });
      expect(r!.seatId).not.toBe(groupSeats[0].id);
    }
  });
});

describe("routeKaizen", () => {
  it("キーワードで担当部署を決める", () => {
    expect(routeKaizen("代車の空きが営業から見えない", "業務の手間").department).toBe("サービス部");
    expect(routeKaizen("複合機の用紙がすぐ切れる", "設備").department).toBe("総務");
    expect(routeKaizen("通路で転倒しそうになった", "その他").department).toBe("安全衛生委員会");
  });
  it("該当なしは総務に振り分け、判定不能を返す", () => {
    const r = routeKaizen("なんとなく相談したい", "その他");
    expect(r.isFallback).toBe(true);
  });
});

describe("detectPii", () => {
  it("電話番号と車両番号を検知する", () => {
    expect(detectPii("連絡先は0742-12-3456です")).toContain("電話番号");
    expect(detectPii("奈良 300 あ 12-34 の点検")).toContain("車両番号");
    expect(detectPii("今日の納車、みんな笑顔でした")).toEqual([]);
  });
});
