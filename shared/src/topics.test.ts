import { describe, expect, it } from "vitest";
import { pickTopics } from "./topics.js";
import type { Post, SharedTask } from "./types.js";

const post = (id: string, kind: Post["kind"], branchId: string, createdAt: string, body = id): Post => ({
  id, kind, authorId: "u1", authorDept: "sales", branchId, category: "", body, createdAt, reactions: 0,
});
const task = (id: string, createdAt: string, dueDate?: string): SharedTask => ({ id, title: `タスク${id}`, createdBy: "u1", createdAt, doneBy: [], dueDate });

describe("pickTopics", () => {
  const tasks = [task("a", "2026-09-01T00:00:00Z"), task("b", "2026-09-10T00:00:00Z", "2026-09-30")];
  const official = [post("o1", "official", "hq", "2026-09-01T00:00:00Z"), post("o2", "official", "hq", "2026-09-12T00:00:00Z")];
  const hitokoto = [post("h1", "hitokoto", "a", "2026-09-01T00:00:00Z"), post("h2", "hitokoto", "hq", "2026-09-02T00:00:00Z"), post("h3", "hitokoto", "hq", "2026-09-03T00:00:00Z")];

  it("アナウンス・公式・所属支店のニュースを1件ずつ、この順で返す", () => {
    const t = pickTopics({ tasks, official, hitokoto, branchId: "hq", seed: 1 });
    expect(t.map((x) => x.kind)).toEqual(["announce", "official", "branch"]);
    expect(t[0].text).toBe("タスクb"); // 最新
    expect(t[0].sub).toBe("期限 2026/09/30");
    expect(t[1].text).toBe("o2"); // 最新
  });

  it("支店ニュースは所属支店の投稿からだけ選ぶ", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const t = pickTopics({ tasks: [], official: [], hitokoto, branchId: "hq", seed });
      expect(["h2", "h3"]).toContain(t[0].text);
    }
  });

  it("同じ seed なら同じ結果（画面を開き直しても変わらない）", () => {
    const a = pickTopics({ tasks, official, hitokoto, branchId: "hq", seed: 7 });
    const b = pickTopics({ tasks, official, hitokoto, branchId: "hq", seed: 7 });
    expect(a).toEqual(b);
  });

  it("材料がなければ、その項目は出さない", () => {
    expect(pickTopics({ tasks: [], official: [], hitokoto: [], branchId: "hq", seed: 1 })).toEqual([]);
  });
});