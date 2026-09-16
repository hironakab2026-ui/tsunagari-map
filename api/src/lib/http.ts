import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { authenticate, HttpError, type User } from "./auth.js";
import { Service } from "./service.js";
import { MemoryStore, SharePointStore, type DocStore } from "./store.js";

let service: Service | null = null;
let ready: Promise<void> | null = null;

export async function getService() {
  if (!service) {
    const store: DocStore = process.env.STORE === "sharepoint" ? new SharePointStore(process.env.SP_SITE_ID!) : new MemoryStore();
    service = new Service(store);
    // メモリ保存のときはデモデータを入れる
    ready = process.env.STORE === "sharepoint" ? Promise.resolve() : service.seed();
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
