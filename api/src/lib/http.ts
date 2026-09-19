import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { authenticate, HttpError, type User } from "./auth.js";
import { Service } from "./service.js";
import { MemoryStore, SharePointStore, SqliteStore, type DocStore } from "./store.js";

let service: Service | null = null;
let ready: Promise<void> | null = null;

export async function getService() {
  if (!service) {
    const storeKind = process.env.STORE;
    const store: DocStore =
      storeKind === "sharepoint" ? new SharePointStore(process.env.SP_SITE_ID!) :
      storeKind === "sqlite" ? new SqliteStore(process.env.SQLITE_DB_PATH ?? "./.data/tsunagari.db", process.env.SQLITE_PHOTO_DIR ?? "./.data/photos") :
      new MemoryStore();
    service = new Service(store);
    if (storeKind === "sharepoint") {
      ready = Promise.resolve();
    } else if (storeKind === "sqlite") {
      // 初回（データがまだ無いとき）だけデモデータを入れる。以後の起動では既存データをそのまま使う
      ready = store.list("Branches").then((existing) => (existing.length ? undefined : service!.seed()));
    } else {
      // メモリ保存は起動のたびに消えるので、毎回デモデータを入れる
      ready = service.seed();
    }
    // 認証なしのデモ動作のときは、席が埋まり自己紹介も入った「使われている姿」にしておく
    if (storeKind !== "sharepoint" && process.env.AUTH_DISABLED === "true") {
      const svc = service;
      ready = ready!.then(() => svc.seedDemoState(process.env.DEV_USER_ID ?? "demo"));
    }
  }
  await ready;
  return service;
}

type Handler = (ctx: { req: HttpRequest; user: User; svc: Service; body: any; log: InvocationContext }) => Promise<unknown>;

/** 認証・JSON変換・エラー応答をまとめる */
export function route(handler: Handler) {
  return async (req: HttpRequest, log: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const user = await authenticate(req);
      const svc = await getService();
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await req.json().catch(() => ({})) : undefined;
      const result = await handler({ req, user, svc, body, log });
      return result === undefined ? { status: 204 } : { status: 200, jsonBody: result };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: e.message };
      log.error(e);
      return { status: 500, body: "サーバーでエラーが発生しました。時間をおいて再度お試しください" };
    }
  };
}
