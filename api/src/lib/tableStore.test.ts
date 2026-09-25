import { beforeAll, describe, expect, it } from "vitest";
import { Service } from "./service.js";
import { TableStore, split } from "./tableStore.js";
import type { User } from "./auth.js";

/**
 * Azure Table Storage の実際の動きを確かめるテスト。ローカルのエミュレーター（Azurite）が必要なので、
 * 環境変数 AZURITE_CONNECTION（例：UseDevelopmentStorage=true）があるときだけ実行する。
 */
const conn = process.env.AZURITE_CONNECTION;

describe("split", () => {
  it("長い文字列を、上限に収まるように分け、つなぐと元に戻る", () => {
    const s = "あ".repeat(50_000);
    const parts = split(s);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 16_000)).toBe(true);
    expect(parts.join("")).toBe(s);
  });
  it("絵文字（サロゲートペア）の途中では切らない", () => {
    const s = "😀".repeat(20_000);
    const parts = split(s);
    for (const p of parts) expect(p.charCodeAt(p.length - 1) >= 0xd800 && p.charCodeAt(p.length - 1) <= 0xdbff).toBe(false);
    expect(parts.join("")).toBe(s);
  });
  it("空でも1つ返す", () => { expect(split("")).toEqual([""]); });
});

describe.skipIf(!conn)("TableStore（Azurite）", () => {
  let store: TableStore;
  const suffix = Date.now();
  beforeAll(() => { store = new TableStore(conn!, `TestDocs${suffix}`, `test-photos-${suffix}`); });

  it("保存・取得・一覧・削除ができる。IDに記号があってもよい", async () => {
    await store.put("Posts", "a/b:c#1?", "hitokoto", { id: "a/b:c#1?", body: "こんにちは" });
    await store.put("Posts", "p2", "kaizen", { id: "p2" });
    expect(await store.get("Posts", "a/b:c#1?")).toEqual({ id: "a/b:c#1?", body: "こんにちは" });
    expect((await store.list("Posts")).length).toBe(2);
    expect(await store.list("Posts", "kaizen")).toEqual([{ id: "p2" }]);
    await store.remove("Posts", "p2");
    expect(await store.get("Posts", "p2")).toBeNull();
    await store.remove("Posts", "p2"); // 無くてもエラーにならない
  });

  it("コレクションが違えば、同じIDでも別のもの", async () => {
    await store.put("People", "x", "hq", { v: 1 });
    await store.put("Branches", "x", "all", { v: 2 });
    expect(await store.get("People", "x")).toEqual({ v: 1 });
    expect(await store.get("Branches", "x")).toEqual({ v: 2 });
  });

  it("上書きすると、前の内容は残らない。大きな文書（アイコン画像など）も保存できる", async () => {
    const big = { avatarUrl: `data:image/jpeg;base64,${"A".repeat(200_000)}`, name: "山本" };
    await store.put("People", "big", "hq", big);
    expect(await store.get("People", "big")).toEqual(big);
    await store.put("People", "big", "hq", { name: "小さくなった" });
    expect(await store.get("People", "big")).toEqual({ name: "小さくなった" });
  });

  it("写真・動画を保存して読み出せる。無いものは null", async () => {
    await store.savePhoto("t.png", new Uint8Array([1, 2, 3, 250]), "image/png");
    const r = await store.readPhoto("t.png");
    expect(r?.contentType).toBe("image/png");
    expect([...r!.bytes]).toEqual([1, 2, 3, 250]);
    expect(await store.readPhoto("none.png")).toBeNull();
  });

  it("2つの Service が同じ保存先を見ていれば、片方の抽選がもう片方にすぐ見える（サーバーが複数台でもずれない）", async () => {
    const a = new Service(store);
    const b = new Service(store);
    await a.seed();
    const u: User = { id: "u01", email: "", name: "", roles: [] };
    const { seat } = await a.draw(u);
    const floor = await b.floor(u);
    expect(floor.assignments[seat.id]).toContain("u01");
  });
});