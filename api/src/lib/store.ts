import { graph } from "./graph.js";

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
  "Wishes", "Posts", "Reactions", "AnonymousAudit", "RoutingRules",
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
      const ext = name.split(".").pop();
      return { bytes: new Uint8Array(buf), contentType: ext === "png" ? "image/png" : "image/jpeg" };
    } catch {
      return null;
    }
  }
}
