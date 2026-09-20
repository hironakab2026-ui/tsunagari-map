import { describe, expect, it } from "vitest";
import { aggregateVoiceMap } from "./aggregate.js";
import { SEED_BRANCHES, SEED_PEOPLE } from "./seed.js";
import type { Person, Post } from "./types.js";

const post = (id: string, kind: Post["kind"], branchId: string, category: string, extra: Partial<Post> = {}): Post => ({
  id, kind, authorId: "u01", authorDept: "sales", branchId, category, body: id, createdAt: "2026-09-01T00:00:00Z", reactions: 0, ...extra,
});
const people: Person[] = [...SEED_PEOPLE, { ...SEED_PEOPLE[0], id: "va", branchId: "a" }, { ...SEED_PEOPLE[0], id: "vb", branchId: "b" }];

describe("aggregateVoiceMap", () => {
  it("要改善事項と業務改善報告だけを数え、ひとこと・公式は含めない", () => {
    const { stats } = aggregateVoiceMap(SEED_BRANCHES, [
      post("k1", "kaizen", "hq", "安全"), post("r1", "report", "hq", "安全"), post("r2", "report", "hq", "お客様対応"),
      post("h1", "hitokoto", "hq", "できごと"), post("o1", "official", "hq", "お知らせ"),
    ], people);
    const hq = stats.find((s) => s.branchId === "hq")!;
    expect(hq.issue).toBe(1);
    expect(hq.report).toBe(2);
  });

  it("分野ごと・種類ごとに件数を分ける。以前の分類名は今の分野に読み替える", () => {
    const { stats } = aggregateVoiceMap(SEED_BRANCHES, [
      post("k1", "kaizen", "a", "業務の手間"), post("k2", "kaizen", "a", "業務の効率化"), post("k3", "kaizen", "a", "設備"), post("r1", "report", "a", "設備・環境"),
    ], people);
    const a = stats.find((s) => s.branchId === "a")!;
    expect(a.fields.issue).toEqual({ efficiency: 2, facility: 1 });
    expect(a.fields.report).toEqual({ facility: 1 });
  });

  it("一緒に取り組んだ人が別の拠点なら、拠点どうしを結ぶ。部門は問わない", () => {
    const { collaborations } = aggregateVoiceMap(SEED_BRANCHES, [
      post("r1", "report", "a", "安全", { authorId: "va", coAuthorIds: ["vb"] }),
      post("k1", "kaizen", "hq", "安全", { authorId: "u01", coAuthorIds: ["u02"] }), // 同じ拠点だけ → 線なし
    ], people);
    expect(collaborations).toEqual([["a", "b"]]);
  });

  it("投稿のない拠点も0件で返す", () => {
    const { stats } = aggregateVoiceMap(SEED_BRANCHES, [], people);
    expect(stats).toHaveLength(SEED_BRANCHES.length);
    expect(stats.every((s) => s.issue === 0 && s.report === 0)).toBe(true);
  });
});