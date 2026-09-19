import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { graph } from "./graph.js";

// node:sqlite は Node.js 20（本番の Azure Functions ランタイム）には存在しないため、
// この関数は SqliteStore を実際に使うとき（コンストラクタの中）だけ呼び出す。
// また Vite/Vitest が静的 import だと node:sqlite を解決できないため、
// process.getBuiltinModule 経由で読み込む
function loadSqliteModule() {
  const mod = process.getBuiltinModule?.("node:sqlite");
  if (!mod) throw new Error("この Node.js には node:sqlite がありません。STORE=sqlite には Node.js 22.5 以上が必要です");
  return mod;
}

/**
 * データ保存の抽象化。コレクション（=SharePoint リスト）ごとに JSON 文書を保存する。
 * partition は絞り込み用のインデックス列（拠点ID、投稿種別など）。
 */
export interface DocStore {
  list<T>(collection: Collection, partition?: string): Promise<T[]>;
  get<T>(collection: Collection, id: string): Promise<T | null>;
  put<T>(collection: Collection, id: string, partition: string, data: T): Promise<void>;
  remove(collection: Collection, id: string): Promise<void>;
  savePhoto(name: string, bytes: Uint8Array, contentType: string): Promise<string>;
  readPhoto(name: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

export const COLLECTIONS = [
  "People", "Branches", "Seats", "Assignments",
  "Posts", "Reactions", "AnonymousAudit", "RoutingRules",
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export class MemoryStore implements DocStore {
  private data = new Map<string, Map<string, { partition: string; data: unknown }>>();
  private photos = new Map<string, { bytes: Uint8Array; contentType: string }>();
  private col(c: string) {
    if (!this.data.has(c)) this.data.set(c, new Map());
    return this.data.get(c)!;
  }
  async list<T>(c: Collection, partition?: string) {
    return [...this.col(c).values()].filter((d) => !partition || d.partition === partition).map((d) => structuredClone(d.data) as T);
  }
  async get<T>(c: Collection, id: string) {
    const d = this.col(c).get(id);
    return d ? (structuredClone(d.data) as T) : null;
  }
  async put<T>(c: Collection, id: string, partition: string, data: T) {
    this.col(c).set(id, { partition, data: structuredClone(data) });
  }
  async remove(c: Collection, id: string) {
    this.col(c).delete(id);
  }
  async savePhoto(name: string, bytes: Uint8Array, contentType: string) {
    this.photos.set(name, { bytes, contentType });
    return name;
  }
  async readPhoto(name: string) {
    return this.photos.get(name) ?? null;
  }
}

/**
 * ローカルファイルに実際に保存する DocStore。Microsoft 365 のアカウントなしで、
 * サーバーを再起動してもデータが消えないことを確認したいときに使う（STORE=sqlite）。
 * SharePointStore と同じ「DocId/PartitionKey/Data(JSON)」の汎用スキーマを、
 * Node.js 組み込みの node:sqlite で1つのテーブルに保存するだけの単純な実装。
 */
export class SqliteStore implements DocStore {
  private db: DatabaseSyncType;
  private photoDir: string;
  private closed = false;

  constructor(dbPath: string, photoDir: string) {
    const { DatabaseSync } = loadSqliteModule();
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        collection TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        partition_key TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (collection, doc_id)
      );
      CREATE INDEX IF NOT EXISTS idx_docs_partition ON docs(collection, partition_key);
    `);
    this.photoDir = photoDir;
    mkdirSync(photoDir, { recursive: true });
  }

  async list<T>(c: Collection, partition?: string) {
    const rows = partition
      ? this.db.prepare("SELECT data FROM docs WHERE collection = ? AND partition_key = ?").all(c, partition)
      : this.db.prepare("SELECT data FROM docs WHERE collection = ?").all(c);
    return rows.map((r) => JSON.parse(r.data as string) as T);
  }

  async get<T>(c: Collection, id: string) {
    const row = this.db.prepare("SELECT data FROM docs WHERE collection = ? AND doc_id = ?").get(c, id);
    return row ? (JSON.parse(row.data as string) as T) : null;
  }

  async put<T>(c: Collection, id: string, partition: string, data: T) {
    this.db
      .prepare(
        `INSERT INTO docs (collection, doc_id, partition_key, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(collection, doc_id) DO UPDATE SET partition_key = excluded.partition_key, data = excluded.data`,
      )
      .run(c, id, partition, JSON.stringify(data));
  }

  async remove(c: Collection, id: string) {
    this.db.prepare("DELETE FROM docs WHERE collection = ? AND doc_id = ?").run(c, id);
  }

  async savePhoto(name: string, bytes: Uint8Array, contentType: string) {
    writeFileSync(join(this.photoDir, name), bytes);
    writeFileSync(join(this.photoDir, `${name}.contenttype`), contentType);
    return name;
  }

  async readPhoto(name: string) {
    const path = join(this.photoDir, name);
    if (!existsSync(path)) return null;
    const typePath = `${path}.contenttype`;
    const contentType = existsSync(typePath) ? readFileSync(typePath, "utf8") : "application/octet-stream";
    return { bytes: readFileSync(path), contentType };
  }

  /** DBファイルへのハンドルを閉じる（テストで一時ディレクトリを削除する前などに使う）。複数回呼んでも安全 */
  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}

interface ListItem {
  id: string;
  fields: { DocId: string; PartitionKey: string; Data: string };
}

/** SharePoint リストを使う実装。リストは scripts/provision-sharepoint.mjs で作成する */
export class SharePointStore implements DocStore {
  private listIds: Promise<Map<string, string>> | null = null;
  constructor(private siteId: string) {}

  /** リスト名 → リストID を一度だけ取得してキャッシュする */
  private async base(c: Collection) {
    this.listIds ??= graph<{ value: { id: string; displayName: string }[] }>(`/sites/${this.siteId}/lists?$select=id,displayName&$top=200`)
      .then((r) => new Map(r.value.map((l) => [l.displayName, l.id])));
    const id = (await this.listIds).get(c);
    if (!id) throw new Error(`SharePoint リスト「${c}」がありません。scripts/provision-sharepoint.mjs を実行してください`);
    return `/sites/${this.siteId}/lists/${id}/items`;
  }

  private async query(c: Collection, filter?: string): Promise<ListItem[]> {
    const out: ListItem[] = [];
    let url: string | undefined =
      `${await this.base(c)}?$expand=fields($select=DocId,PartitionKey,Data)&$top=500` +
      (filter ? `&$filter=${encodeURIComponent(filter)}` : "");
    while (url) {
      const page: { value: ListItem[]; "@odata.nextLink"?: string } = await graph(url, {
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
      });
      out.push(...page.value);
      url = page["@odata.nextLink"];
    }
    return out;
  }

  private esc = (v: string) => v.replace(/'/g, "''");

  async list<T>(c: Collection, partition?: string) {
    const items = await this.query(c, partition ? `fields/PartitionKey eq '${this.esc(partition)}'` : undefined);
    return items.map((i) => JSON.parse(i.fields.Data) as T);
  }

  async get<T>(c: Collection, id: string) {
    const [item] = await this.query(c, `fields/DocId eq '${this.esc(id)}'`);
    return item ? (JSON.parse(item.fields.Data) as T) : null;
  }

  async put<T>(c: Collection, id: string, partition: string, data: T) {
    const [existing] = await this.query(c, `fields/DocId eq '${this.esc(id)}'`);
    const fields = { Title: id.slice(0, 255), DocId: id, PartitionKey: partition, Data: JSON.stringify(data) };
    if (existing) {
      await graph(`${await this.base(c)}/${existing.id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
    } else {
      await graph(await this.base(c), { method: "POST", body: JSON.stringify({ fields }) });
    }
  }

  async remove(c: Collection, id: string) {
    const [existing] = await this.query(c, `fields/DocId eq '${this.esc(id)}'`);
    if (existing) await graph(`${await this.base(c)}/${existing.id}`, { method: "DELETE" });
  }

  async savePhoto(name: string, bytes: Uint8Array, contentType: string) {
    await graph(`/sites/${this.siteId}/drive/root:/tsunagari-photos/${encodeURIComponent(name)}:/content`, {
      method: "PUT", body: bytes as unknown as BodyInit, headers: { "Content-Type": contentType },
    });
    return name;
  }

  async readPhoto(name: string) {
    try {
      const buf = await graph<ArrayBuffer>(`/sites/${this.siteId}/drive/root:/tsunagari-photos/${encodeURIComponent(name)}:/content`);
      const ext = name.split(".").pop() ?? "";
      const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", mp4: "video/mp4", webm: "video/webm" };
      return { bytes: new Uint8Array(buf), contentType: types[ext] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }
}
