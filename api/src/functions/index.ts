import { app } from "@azure/functions";
import { authenticate } from "../lib/auth.js";
import { getService, route } from "../lib/http.js";

// 名刺
app.http("me", { methods: ["GET"], route: "me", authLevel: "anonymous", handler: route(async ({ user, svc }) => {
  const me = await svc.me(user);
  return { ...me, roles: user.roles, isSeatAdmin: await svc.isSeatAdmin(user, me.branchId) };
}) });
app.http("updateMe", { methods: ["PUT"], route: "me", authLevel: "anonymous", handler: route(async ({ user, svc, body }) => ({ ...(await svc.updateMe(user, body)), roles: user.roles })) });
app.http("people", { methods: ["GET"], route: "people", authLevel: "anonymous", handler: route(({ user, svc }) => svc.people(user)) });
app.http("branches", { methods: ["GET"], route: "branches", authLevel: "anonymous", handler: route(({ svc }) => svc.branches()) });

// 座席
app.http("floor", { methods: ["GET"], route: "floor", authLevel: "anonymous", handler: route(({ req, user, svc }) => svc.floor(user, req.query.get("branchId") ?? undefined)) });
app.http("checkin", { methods: ["POST"], route: "checkin", authLevel: "anonymous", handler: route(({ user, svc, body }) => svc.checkIn(user, body.seatCode)) });
app.http("checkout", { methods: ["POST"], route: "checkout", authLevel: "anonymous", handler: route(async ({ user, svc }) => { await svc.checkOut(user); }) });
app.http("draw", { methods: ["POST"], route: "seats/draw", authLevel: "anonymous", handler: route(({ user, svc, body }) => svc.draw(user, body?.branchId)) });

// 座席の設定（支社ごとの座席管理者のみ編集可）
app.http("seatConfig", { methods: ["GET"], route: "branches/{id}/seat-config", authLevel: "anonymous", handler: route(({ req, svc }) => svc.seatConfig(req.params.id)) });
app.http("updateSeatConfig", { methods: ["PUT"], route: "branches/{id}/seat-config", authLevel: "anonymous", handler: route(({ req, user, svc, body }) => svc.updateSeatConfig(user, req.params.id, body)) });
app.http("seatAdmins", { methods: ["GET"], route: "branches/{id}/seat-admins", authLevel: "anonymous", handler: route(({ req, svc }) => svc.seatAdmins(req.params.id)) });
app.http("addSeatAdmin", { methods: ["POST"], route: "branches/{id}/seat-admins", authLevel: "anonymous", handler: route(async ({ req, user, svc, body }) => { await svc.addSeatAdmin(user, req.params.id, body.personId); }) });
app.http("removeSeatAdmin", { methods: ["DELETE"], route: "branches/{id}/seat-admins/{personId}", authLevel: "anonymous", handler: route(async ({ req, user, svc }) => { await svc.removeSeatAdmin(user, req.params.id, req.params.personId); }) });

// 声
app.http("posts", { methods: ["GET"], route: "posts", authLevel: "anonymous", handler: route(({ req, svc }) => svc.posts((req.query.get("kind") ?? "hitokoto") as "hitokoto" | "kaizen" | "official")) });
app.http("createPost", { methods: ["POST"], route: "posts", authLevel: "anonymous", handler: route(async ({ user, svc, body }) => (await svc.createPost(user, body)).post) });
app.http("react", { methods: ["POST"], route: "posts/{id}/reactions", authLevel: "anonymous", handler: route(async ({ req, user, svc }) => { await svc.react(user, req.params.id); }) });
app.http("status", { methods: ["PATCH"], route: "posts/{id}/status", authLevel: "anonymous", handler: route(async ({ req, user, svc, body }) => { await svc.updateStatus(user, req.params.id, body.status, body.assignedTo); }) });
app.http("pick", { methods: ["POST"], route: "posts/{id}/pick", authLevel: "anonymous", handler: route(async ({ req, user, svc }) => { await svc.pickForNews(user, req.params.id); }) });
app.http("voiceMap", { methods: ["GET"], route: "voice-map", authLevel: "anonymous", handler: route(({ svc }) => svc.voiceMap()) });

// オンライン表示（アプリを開いている間、定期的に呼ばれる）
app.http("presence", { methods: ["POST"], route: "presence", authLevel: "anonymous", handler: route(async ({ user, svc }) => { await svc.heartbeat(user); }) });

// 共有タスク（全体へのアナウンス。作成・削除は広報）
app.http("tasks", { methods: ["GET"], route: "tasks", authLevel: "anonymous", handler: route(({ user, svc }) => svc.tasks(user)) });
app.http("createTask", { methods: ["POST"], route: "tasks", authLevel: "anonymous", handler: route(({ user, svc, body }) => svc.createTask(user, body)) });
app.http("taskDone", { methods: ["POST"], route: "tasks/{id}/done", authLevel: "anonymous", handler: route(async ({ req, user, svc, body }) => { await svc.setTaskDone(user, req.params.id, !!body?.done); }) });
app.http("deleteTask", { methods: ["DELETE"], route: "tasks/{id}", authLevel: "anonymous", handler: route(async ({ req, user, svc }) => { await svc.deleteTask(user, req.params.id); }) });

// アプリ内チャット（1対1）
app.http("chats", { methods: ["GET"], route: "chats", authLevel: "anonymous", handler: route(({ user, svc }) => svc.chatThreads(user)) });
app.http("chatMessages", { methods: ["GET"], route: "chats/{personId}", authLevel: "anonymous", handler: route(({ req, user, svc }) => svc.messages(user, req.params.personId)) });
app.http("sendChat", { methods: ["POST"], route: "chats/{personId}", authLevel: "anonymous", handler: route(({ req, user, svc, body }) => svc.sendMessage(user, req.params.personId, body?.body)) });

// ギャラリー（投稿された写真）
app.http("gallery", { methods: ["GET"], route: "gallery", authLevel: "anonymous", handler: route(({ svc }) => svc.gallery()) });

// 写真（認証付きで配信）
app.http("photo", {
  methods: ["GET"], route: "photos/{name}", authLevel: "anonymous",
  handler: async (req, log) => {
    try {
      await authenticate(req);
      const photo = await (await getService()).photo(req.params.name);
      return photo ? { status: 200, body: photo.bytes, headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=86400" } } : { status: 404 };
    } catch (e) {
      log.warn(e);
      return { status: 401 };
    }
  },
});

// 毎日 20:00（日本時間）に全員の着席を解除。NCRONTAB は UTC
app.timer("autoCheckout", {
  schedule: "0 0 11 * * *",
  handler: async (_t, log) => {
    const n = await (await getService()).checkOutEveryone();
    log.info(`着席を自動解除: ${n}件`);
  },
});

// 毎朝 9:00（日本時間）に、動きのない改善の声を確認
app.timer("kaizenReminder", {
  schedule: "0 0 0 * * 1-5",
  handler: async (_t, log) => {
    const days = Number(process.env.KAIZEN_REMIND_DAYS ?? "5");
    const stale = await (await getService()).staleKaizen(days);
    // TODO: 部署ごとの責任者（RoutingRules に ownerIds を追加）へ notifyUsers で督促
    log.info(`${days}日以上動きのない改善の声: ${stale.length}件`);
  },
});
