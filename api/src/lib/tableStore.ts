import { TableClient, odata, type TableEntity } from "@azure/data-tables";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import type { Collection, DocStore } from "./store.js";

/** 1つの文字列項目に入れる文字数。テーブルの1項目は64KBまでで、日本語は1文字2バイトなので余裕をみる */
const CHUNK = 16_000;

/** 行キーに使えない文字（/ \ # ? など）を含む ID も扱えるようにする */
const rowKey = (id: string) => encodeURIComponent(id);

const isNotFound = (e: unknown) => (e as { statusCode?: number })?.statusCode === 404;

/**
 * Azure Table Storage（データ）と Blob Storage（写真・動画）に保存する DocStore（STORE=table）。
 * Function App がすでに持っているストレージアカウントをそのまま使える。
 *
 * SqliteStore はサーバー1台の中のファイルなので、サーバーが複数台に増えると、台ごとに別のデータになる
 * （抽選した席が別の台には見えない、など）。こちらは全台が同じデータを見るので、そうならない。
 * SharePointStore と同じ「DocId/PartitionKey/Data(JSON)」の汎用スキーマ。
 */
export class TableStore implements DocStore {
  private table: TableClient;
  private photos: ContainerClient;
  private ready: Promise<void>;

  constructor(connectionString: string, tableName = "TsunagariDocs", container = "tsunagari-photos") {
    const table = TableClient.fromConnectionString(connectionString, tableName, { allowInsecureConnection: connectionString.includes("UseDevelopmentStorage") });
    const photos = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(container);
    this.table = table;
    this.photos = photos;
    this.ready = (async () => {
      await table.createTable();
      await photos.createIfNotExists();
    })();
    this.ready.catch(() => undefined); // 失敗は、最初に使ったときに呼び出し側へ伝える
  }

  async list<T>(c: Collection, partition?: string): Promise<T[]> {
    await this.ready;
    const filter = partition ? odata`PartitionKey eq ${c} and p eq ${partition}` : odata`PartitionKey eq ${c}`;
    const out: T[] = [];
    for await (const e of this.table.listEntities<Record<string, unknown>>({ queryOptions: { filter } })) out.push(decode<T>(e));
    return out;
  }

  async get<T>(c: Collection, id: string): Promise<T | null> {
    await this.ready;
    try {
      return decode<T>(await this.table.getEntity<Record<string, unknown>>(c, rowKey(id)));
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async put<T>(c: Collection, id: string, partition: string, data: T): Promise<void> {
    await this.ready;
    const chunks = split(JSON.stringify(data));
    const entity: TableEntity<Record<string, unknown>> = { partitionKey: c, rowKey: rowKey(id), p: partition, n: chunks.length };
    chunks.forEach((s, i) => { entity[`d${i}`] = s; });
    await this.table.upsertEntity(entity, "Replace");
  }

  async remove(c: Collection, id: string): Promise<void> {
    await this.ready;
    try {
      await this.table.deleteEntity(c, rowKey(id));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  async savePhoto(name: string, bytes: Uint8Array, contentType: string): Promise<string> {
    await this.ready;
    await this.photos.getBlockBlobClient(name).uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType } });
    return name;
  }

  async readPhoto(name: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    await this.ready;
    const blob = this.photos.getBlockBlobClient(name);
    try {
      const bytes = await blob.downloadToBuffer();
      const props = await blob.getProperties();
      return { bytes, contentType: props.contentType ?? "application/octet-stream" };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
}

/** 長い JSON を、項目の上限に収まる長さに分ける（サロゲートペアの途中では切らない） */
export function split(json: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < json.length) {
    let end = Math.min(i + CHUNK, json.length);
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end--; // 前半だけで切れてしまうときは、1文字手前で切る
    out.push(json.slice(i, end));
    i = end;
  }
  return out.length ? out : [""];
}

function decode<T>(e: Record<string, unknown>): T {
  const n = Number(e.n ?? 0);
  let json = "";
  for (let i = 0; i < n; i++) json += String(e[`d${i}`] ?? "");
  return JSON.parse(json) as T;
}
