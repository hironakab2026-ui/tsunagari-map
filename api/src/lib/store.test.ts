import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "./store.js";

describe("SqliteStore", () => {
  let dir: string;
  let stores: SqliteStore[];
  const open = (dbFile = "test.db") => {
    const store = new SqliteStore(join(dir, dbFile), join(dir, "photos"));
    stores.push(store);
    return store;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tsunagari-sqlite-"));
    stores = [];
  });
  afterEach(() => {
    for (const s of stores) s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("put したデータを get / list で読み出せる", async () => {
    const store = open();
    await store.put("Posts", "p1", "hitokoto", { id: "p1", body: "hello" });
    await store.put("Posts", "p2", "kaizen", { id: "p2", body: "world" });
    expect(await store.get("Posts", "p1")).toEqual({ id: "p1", body: "hello" });
    expect(await store.list("Posts")).toHaveLength(2);
    expect(await store.list("Posts", "hitokoto")).toEqual([{ id: "p1", body: "hello" }]);
  });

  it("同じキーへの put は上書きする", async () => {
    const store = open();
    await store.put("Posts", "p1", "hitokoto", { id: "p1", body: "v1" });
    await store.put("Posts", "p1", "hitokoto", { id: "p1", body: "v2" });
    expect(await store.list("Posts")).toHaveLength(1);
    expect(await store.get("Posts", "p1")).toEqual({ id: "p1", body: "v2" });
  });

  it("remove で削除できる", async () => {
    const store = open();
    await store.put("Posts", "p1", "hitokoto", { id: "p1" });
    await store.remove("Posts", "p1");
    expect(await store.get("Posts", "p1")).toBeNull();
  });

  it("プロセスを跨いでも（DBファイルを再オープンしても）データが残る", async () => {
    const first = open();
    await first.put("Branches", "hq", "all", { id: "hq", name: "本社" });
    first.close();

    const reopened = open();
    expect(await reopened.get("Branches", "hq")).toEqual({ id: "hq", name: "本社" });
  });

  it("写真もファイルとして保存・読み出しできる", async () => {
    const store = open();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.savePhoto("a.png", bytes, "image/png");
    const read = await store.readPhoto("a.png");
    expect(read?.contentType).toBe("image/png");
    expect([...(read?.bytes ?? [])]).toEqual([1, 2, 3, 4]);
    expect(existsSync(join(dir, "photos", "a.png"))).toBe(true);
  });
});
