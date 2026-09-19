import { describe, expect, it } from "vitest";
import { EMPTY_POST_FILTER, activeFilterCount, filterPosts, postStatus, type PostFilter } from "./postFilter.js";
import type { Post } from "./types.js";

const NOW = Date.parse("2026-09-19T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86400_000).toISOString();

const post = (over: Partial<Post> & { id: string }): Post => ({
  kind: "hitokoto", authorId: "u1", authorDept: "sales", branchId: "hq", category: "できごと", body: "本文",
  createdAt: daysAgo(1), reactions: 0, ...over,
});

const posts: Post[] = [
  post({ id: "a", body: "EV充電の相談会を開きました", category: "できごと", branchId: "b", authorId: "u2", authorDept: "eng", reactions: 5, createdAt: daysAgo(2) }),
  post({ id: "b", body: "夜遅くの点検で助かりました", category: "ありがとう", branchId: "d", authorId: "u3", reactions: 20, createdAt: daysAgo(10), pickedForNews: true }),
  post({ id: "c", kind: "kaizen", body: "代車の空きが見えない", category: "業務の手間", branchId: "d", authorId: "u1", status: "inProgress", reactions: 12, createdAt: daysAgo(20) }),
  post({ id: "d", kind: "kaizen", body: "工具の置き場が足りない", category: "設備", branchId: "hq", authorId: null, authorDept: null, status: "done", reactions: 3, createdAt: daysAgo(40) }),
];
const ctx = {
  meId: "u1", now: NOW,
  authorName: (id: string | null) => ({ u1: "けんた", u2: "つよし", u3: "ゆう" } as Record<string, string>)[id ?? ""] ?? "匿名",
  branchName: (id: string) => ({ hq: "本社", b: "B店", d: "D店" } as Record<string, string>)[id] ?? id,
};
const run = (over: Partial<PostFilter>) => filterPosts(posts, { ...EMPTY_POST_FILTER, ...over }, ctx).map((p) => p.id);

describe("postStatus", () => {
  it("改善の声は対応状況、ひとこと投稿は共有したかどうかを返す", () => {
    expect(postStatus(posts[2])).toMatchObject({ label: "対応中", tone: "progress" });
    expect(postStatus(posts[3])).toMatchObject({ label: "解決済み", tone: "done" });
    expect(postStatus(posts[1])).toMatchObject({ tone: "shared" });
    expect(postStatus(posts[0])).toMatchObject({ label: "まだ共有していない", tone: "unshared" });
  });
});

describe("filterPosts", () => {
  it("条件なしなら新しい順にすべて返す", () => {
    expect(run({})).toEqual(["a", "b", "c", "d"]);
  });

  it("キーワードは本文・種類・投稿者名・支店名を対象に、全角半角を区別せず、複数語はすべて含むものだけ", () => {
    expect(run({ q: "ＥＶ" })).toEqual(["a"]);
    expect(run({ q: "つよし" })).toEqual(["a"]);
    expect(run({ q: "D店" })).toEqual(["b", "c"]);
    expect(run({ q: "d店 代車" })).toEqual(["c"]);
    expect(run({ q: "存在しない語" })).toEqual([]);
  });

  it("種類・支店・部門で絞り込める", () => {
    expect(run({ category: "設備" })).toEqual(["d"]);
    expect(run({ branchId: "d" })).toEqual(["b", "c"]);
    expect(run({ dept: "eng" })).toEqual(["a"]);
  });

  it("状態（解決済み・対応中・共有済み・未共有）で絞り込める", () => {
    expect(run({ status: "done" })).toEqual(["d"]);
    expect(run({ status: "progress" })).toEqual(["c"]);
    expect(run({ status: "shared" })).toEqual(["b"]);
    expect(run({ status: "unshared" })).toEqual(["a"]);
  });

  it("期間で絞り込める（直近1週間・直近1か月）", () => {
    expect(run({ period: "week" })).toEqual(["a"]);
    expect(run({ period: "month" })).toEqual(["a", "b", "c"]);
  });

  it("自分の投稿だけに絞り込める", () => {
    expect(run({ mine: true })).toEqual(["c"]);
  });

  it("拍手が多い順に並べ替えられる", () => {
    expect(run({ sort: "reactions" })).toEqual(["b", "c", "a", "d"]);
  });

  it("条件は組み合わせられる", () => {
    expect(run({ branchId: "d", status: "progress", q: "代車" })).toEqual(["c"]);
    expect(run({ branchId: "d", status: "done" })).toEqual([]);
  });
});

describe("activeFilterCount", () => {
  it("初期値から変えた条件の数を数える（検索欄は数えない）", () => {
    expect(activeFilterCount(EMPTY_POST_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_POST_FILTER, q: "EV" })).toBe(0);
    expect(activeFilterCount({ ...EMPTY_POST_FILTER, branchId: "d", status: "done", sort: "reactions" })).toBe(3);
  });
});
