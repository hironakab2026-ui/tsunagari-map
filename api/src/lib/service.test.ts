import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Service } from "./service.js";
import { MemoryStore } from "./store.js";
import type { User } from "./auth.js";

const member: User = { id: "u01", email: "", name: "", roles: [] };
const branchSeatAdmin: User = { id: "u05", email: "", name: "", roles: [] }; // hq の seatAdminIds に含まれる
const seatManager: User = { id: "u07", email: "", name: "", roles: ["SeatManager"] };
const kaizenOwner: User = { id: "u09", email: "", name: "", roles: ["KaizenOwner"] };
const pr: User = { id: "u05", email: "", name: "", roles: ["PR"] };

describe("Service", () => {
  let svc: Service;
  let store: MemoryStore;
  beforeEach(async () => {
    store = new MemoryStore();
    svc = new Service(store);
    await svc.seed();
  });

  describe("座席の抽選", () => {
    it("グループ席に空きがあればグループ席から割り当てる", async () => {
      const { seat } = await svc.draw(member);
      expect(seat.kind).toBe("group");
      const floor = await svc.floor(member);
      expect(floor.assignments[seat.id]).toContain("u01");
    });

    it("もう一度抽選しても、同時に2つの席には重複して座らない", async () => {
      await svc.draw(member);
      await svc.draw(member);
      const floor = await svc.floor(member);
      const seatsWithMe = Object.values(floor.assignments).filter((ids) => ids.includes("u01"));
      expect(seatsWithMe).toHaveLength(1);
    });

    it("退席すると席が空席に戻り、再抽選できる", async () => {
      const { seat } = await svc.draw(member);
      await svc.checkOut(member);
      const floor = await svc.floor(member);
      expect(floor.assignments[seat.id]).toEqual([]);
      const again = await svc.draw(member);
      expect(again.seat).toBeDefined();
    });

    it("同時に大勢が抽選しても、席の定員を超えず、同じ人が2席に座ることもない", async () => {
      // hq は、グループ席3つ×4人＋プライベート席4つ＝16人分。20人が同時に押す
      const users = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, email: "", name: `c${i}`, roles: [] }) as User);
      const results = await Promise.allSettled(users.map((u) => svc.draw(u)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(16);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(4); // 満席
      const floor = await svc.floor(member);
      for (const s of floor.seats) expect(floor.counts[s.id] ?? 0).toBeLessThanOrEqual(s.capacity);
      const all = Object.values(floor.assignments).flat();
      expect(new Set(all).size).toBe(all.length);
      expect(all).toHaveLength(16);
    });

    it("席の使用状況は、座席マップに出さない設定の人も数に入れる（空席数・満席の判定）", async () => {
      await svc.updateMe({ ...member, id: "u02" }, { nickname: "みさき" });
      const u2: User = { id: "u02", email: "", name: "", roles: [] };
      const { seat } = await svc.draw(u2);
      const person = await store.get<import("@tsunagari/shared").Person>("People", "u02");
      await store.put("People", "u02", "hq", { ...person!, showOnSeatMap: false });
      const floor = await svc.floor(member);
      expect(floor.assignments[seat.id]).toEqual([]); // 名前は出さない
      expect(floor.counts[seat.id]).toBe(1); // でも、席は埋まっている
    });

    it("退席すると、重複して残っていた自分の着席もすべて消える", async () => {
      const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      await store.put("Assignments", `hq-2F-1:${today}`, "hq", { branchId: "hq", seatId: "hq-2F-1", date: today, personIds: ["u01"] });
      await store.put("Assignments", `hq-2F-2:${today}`, "hq", { branchId: "hq", seatId: "hq-2F-2", date: today, personIds: ["u01", "u02"] });
      await svc.checkOut(member);
      const floor = await svc.floor(member);
      expect(Object.values(floor.assignments).flat()).toEqual(["u02"]);
    });
    it("グループ席が全て満席ならプライベート席に割り当てる", async () => {
      // hq: グループ席3つ×定員4人 = 12人分埋める
      const fillers = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, email: "", name: `f${i}`, roles: [] }) as User);
      for (const f of fillers) await svc.draw(f);
      const { seat } = await svc.draw(member);
      expect(seat.kind).toBe("private");
    });
  });

  describe("支店ごとの座席", () => {
    const aUser: User = { id: "v01", email: "", name: "", roles: [] };
    const aAdmin: User = { id: "v02", email: "", name: "", roles: ["SeatManager"] };
    beforeEach(async () => { await svc.seedDemoState("demo"); });

    it("本社以外の支店でも、座席設定どおりの席が用意され、抽選できる", async () => {
      const floor = await svc.floor(aUser);
      expect(floor.seats.length).toBeGreaterThan(0);
      const { seat } = await svc.draw(aUser);
      expect(seat.branchId).toBe("a");
    });

    it("抽選で支店を選ぶと、その支店の席に着席する。押すまでは着席しない", async () => {
      expect((await svc.floor(member, "b")).assignments && Object.values((await svc.floor(member, "b")).assignments).flat()).not.toContain("u01");
      const { seat } = await svc.draw(member, "b");
      expect(seat.branchId).toBe("b");
      await expect(svc.draw(member, "zzz")).rejects.toThrow("支店の指定");
    });

    it("座席数を増やすと、増えた席も抽選の対象になる", async () => {
      await svc.updateSeatConfig(aAdmin, "a", { groups: [{ capacity: 6, count: 1 }], privateCount: 0 });
      for (let i = 0; i < 6; i++) await svc.draw({ id: `x${i}`, email: "", name: "", roles: [] }).catch(() => undefined);
      const floor = await svc.floor(aUser, "a");
      expect(floor.seats).toHaveLength(1);
      expect(floor.seats[0].capacity).toBe(6);
    });

    it("不正な座席設定は保存できない", async () => {
      await expect(svc.updateSeatConfig(aAdmin, "a", { groups: [{ capacity: Number.NaN, count: 1 }], privateCount: 0 })).rejects.toThrow("座席の指定");
      await expect(svc.updateSeatConfig(aAdmin, "a", { groups: [{ capacity: 4, count: 1.5 }], privateCount: 0 })).rejects.toThrow("座席の指定");
    });

    it("空席がなくて抽選できないとき、いま座っている席は失われない", async () => {
      const { seat } = await svc.draw(aUser);
      await svc.updateSeatConfig(aAdmin, "a", { groups: [], privateCount: 1 });
      await svc.checkIn(aUser, "1");
      await svc.checkIn({ id: "v02", email: "", name: "", roles: [] }, "1").catch(() => undefined);
      void seat;
      await svc.draw(aUser); // 自分の席しかなくても、引き直せる（元の席を空きとして数える）
      const floor = await svc.floor(aUser);
      expect(Object.values(floor.assignments).filter((ids) => ids.includes("v01"))).toHaveLength(1);
    });
  });

  describe("オンライン表示", () => {
    it("アプリを開いた人はオンライン、開いていない人はオフライン", async () => {
      await svc.heartbeat(member);
      const list = await svc.people(branchSeatAdmin);
      expect(list.find((p) => p.id === "u01")?.online).toBe(true);
      expect(list.find((p) => p.id === "u09")?.online).toBe(false);
    });

    it("今日着席中の人は、アプリを開いていなくてもオンライン", async () => {
      await svc.draw({ id: "u09", email: "", name: "", roles: [] });
      const list = await svc.people(member);
      expect(list.find((p) => p.id === "u09")?.online).toBe(true);
    });
  });

  describe("共有タスク", () => {
    it("広報が作成でき、全員に表示される。一般社員は作成できない", async () => {
      await expect(svc.createTask(member, { title: "テスト" })).rejects.toThrow("権限");
      await svc.createTask(pr, { title: "アンケートに回答", dueDate: "2026-10-01" });
      const list = await svc.tasks(member);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ title: "アンケートに回答", done: false, doneCount: 0 });
    });

    it("自分の完了をつけ外しでき、完了数に反映される", async () => {
      const t = await svc.createTask(pr, { title: "提出" });
      await svc.setTaskDone(member, t.id, true);
      await svc.setTaskDone(member, t.id, true); // 重複しない
      expect((await svc.tasks(member))[0]).toMatchObject({ done: true, doneCount: 1 });
      expect((await svc.tasks(kaizenOwner))[0]).toMatchObject({ done: false, doneCount: 1 });
      await svc.setTaskDone(member, t.id, false);
      expect((await svc.tasks(member))[0]).toMatchObject({ done: false, doneCount: 0 });
    });

    it("タイトルが空・期限の形式が不正なら作成できない。削除は広報のみ", async () => {
      await expect(svc.createTask(pr, { title: " " })).rejects.toThrow("タイトル");
      await expect(svc.createTask(pr, { title: "a", dueDate: "来週" })).rejects.toThrow("期限");
      const t = await svc.createTask(pr, { title: "消す" });
      await expect(svc.deleteTask(member, t.id)).rejects.toThrow("権限");
      await svc.deleteTask(pr, t.id);
      expect(await svc.tasks(member)).toHaveLength(0);
    });
  });

  describe("アプリ内チャット", () => {
    it("送ったメッセージが相手に届き、未読になる。開くと既読になる", async () => {
      await svc.sendMessage(member, "u02", "こんにちは");
      const other: User = { id: "u02", email: "", name: "", roles: [] };
      expect(await svc.chatThreads(other)).toMatchObject([{ personId: "u01", unread: 1 }]);
      const list = await svc.messages(other, "u01");
      expect(list.map((m) => m.body)).toEqual(["こんにちは"]);
      expect((await svc.chatThreads(other))[0].unread).toBe(0);
      expect((await svc.chatThreads(member))[0]).toMatchObject({ personId: "u02", unread: 0 });
    });

    it("自分宛て・空・長すぎるメッセージは送れない", async () => {
      await expect(svc.sendMessage(member, "u01", "x")).rejects.toThrow("自分");
      await expect(svc.sendMessage(member, "u02", "  ")).rejects.toThrow("入力");
      await expect(svc.sendMessage(member, "u02", "あ".repeat(501))).rejects.toThrow("500字");
      await expect(svc.sendMessage(member, "nobody", "x")).rejects.toThrow("相手");
    });

    it("他の人同士の会話は見えない", async () => {
      await svc.sendMessage(member, "u02", "ひみつ");
      expect(await svc.messages(kaizenOwner, "u01")).toEqual([]);
      expect(await svc.chatThreads(kaizenOwner)).toEqual([]);
    });
  });

  describe("ギャラリー", () => {
    it("写真つきのひとこと投稿が新しい順に並び、改善の声は含まれない", async () => {
      const png = "data:image/png;base64,iVBORw0KGgo=";
      await svc.createPost(member, { kind: "hitokoto", category: "できごと", body: "写真です", photoDataUrl: png });
      await svc.createPost(member, { kind: "hitokoto", category: "できごと", body: "文字だけ" });
      const g = await svc.gallery();
      expect(g[0].caption).toBe("写真です"); // 最新が先頭
      expect(g.map((x) => x.caption)).not.toContain("文字だけ");
      expect(g.every((x) => x.url.length > 0)).toBe(true);
    });
  });
  describe("デモ表示用データ", () => {
    it("席が埋まり、デモ利用者の名刺は記入済みになる。デモ利用者自身は未着席", async () => {
      await svc.seedDemoState("demo");
      const demo: User = { id: "demo", email: "", name: "", roles: [] };
      const me = await svc.me(demo);
      expect(me.profileCompleted).toBe(true);
      const floor = await svc.floor(demo);
      const seated = Object.values(floor.assignments).flat();
      expect(seated.length).toBeGreaterThanOrEqual(10);
      expect(seated).not.toContain("demo");
    });

    it("ギャラリーの写真、共有タスク、チャットの例が入り、2回呼んでも重複しない", async () => {
      await svc.seedDemoState("demo");
      await svc.seedDemoState("demo");
      const demo: User = { id: "demo", email: "", name: "", roles: [] };
      expect((await svc.gallery()).length).toBeGreaterThanOrEqual(4);
      expect((await svc.tasks(demo)).filter((t) => t.id.startsWith("demo-"))).toHaveLength(3);
      expect(await svc.chatThreads(demo)).toMatchObject([{ personId: "u02", unread: 1 }]);
    });

    it("本社以外の支店を選んでも、席の例が入っている", async () => {
      await svc.seedDemoState("demo");
      const demo: User = { id: "demo", email: "", name: "", roles: [] };
      for (const branch of ["hq", "a", "b", "c", "d", "e"]) {
        const floor = await svc.floor(demo, branch);
        const seated = Object.values(floor.assignments).flat();
        expect(seated.length, branch).toBeGreaterThanOrEqual(5);
        expect(seated.every((id) => id !== "demo")).toBe(true);
        const people = await svc.people(demo);
        expect(seated.every((id) => people.some((p) => p.id === id)), `${branch}の人が名簿にいる`).toBe(true);
      }
    });
    it("声マップに全支店の要改善事項・業務改善報告と、支店をまたぐつながりが出る", async () => {
      await svc.seedDemoState("demo");
      const map = await svc.voiceMap();
      expect(map.stats.every((s) => s.issue + s.report > 0)).toBe(true);
      expect(map.stats.every((s) => Object.keys(s.fields.report).length > 0)).toBe(true);
      expect(map.collaborations.length).toBeGreaterThan(0);
      expect(map.collaborations.every(([a, b]) => a !== b)).toBe(true);
    });
    it("2回呼んでも投稿が重複しない", async () => {
      await svc.seedDemoState("demo");
      const first = (await svc.posts("hitokoto")).length;
      await svc.seedDemoState("demo");
      expect((await svc.posts("hitokoto")).length).toBe(first);
    });

    it("2回呼んでも着席が重複しない", async () => {
      await svc.seedDemoState("demo");
      await svc.seedDemoState("demo");
      const floor = await svc.floor({ id: "demo", email: "", name: "", roles: [] });
      const seated = Object.values(floor.assignments).flat();
      expect(new Set(seated).size).toBe(seated.length);
    });
  });

    describe("席の例（デモ）は消えない", () => {
      afterEach(() => { vi.useRealTimers(); });
      const demo: User = { id: "demo", email: "", name: "", roles: [] };
      const seatedIds = async () => Object.values((await svc.floor(demo)).assignments).flat();

      it("毎日の一斉退席をしても、席の例の人は残り、ふつうの利用者だけが退席する", async () => {
        await svc.seedDemoState("demo");
        const before = await seatedIds();
        expect(before.length).toBeGreaterThanOrEqual(10);
        await svc.draw(demo);
        const removed = await svc.checkOutEveryone();
        expect(removed).toBe(1); // デモ利用者だけ
        expect((await seatedIds()).sort()).toEqual(before.sort());
      });

      it("日が変わっても、その日の席の例が入る。ほかの人がすでに座っている席は変えない", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-09-26T03:00:00Z"));
        await svc.seedDemoState("demo");
        vi.setSystemTime(new Date("2026-09-27T03:00:00Z")); // 翌日（サーバーは動いたまま）
        await svc.draw(demo); // 抽選（席の例が先に入る）
        const next = await seatedIds();
        expect(next.length).toBeGreaterThanOrEqual(11); // 例 + 自分
        expect(next).toContain("demo");
      });
    });
  describe("手動着席（QR・座席コード）", () => {
    it("同じ席に2人は着席できない", async () => {
      // hq のプライベート席は "4"〜"7"（グループ席1〜3の後）
      await svc.checkIn(member, "4");
      await expect(svc.checkIn(branchSeatAdmin, "4")).rejects.toThrow("満席");
    });

    it("退勤処理で全員の着席が解除される", async () => {
      await svc.checkIn(member, "4");
      await svc.checkIn(branchSeatAdmin, "5");
      expect(await svc.checkOutEveryone()).toBe(2);
      const floor = await svc.floor(member);
      expect(Object.values(floor.assignments).every((ids) => ids.length === 0)).toBe(true);
    });
  });

  describe("座席の設定", () => {
    it("一般社員は座席設定を変更できない", async () => {
      await expect(svc.updateSeatConfig(member, "hq", { groups: [{ capacity: 2, count: 1 }], privateCount: 1 })).rejects.toThrow("権限");
    });

    it("支社ごとに指定された座席管理者は変更できる", async () => {
      const seats = await svc.updateSeatConfig(branchSeatAdmin, "hq", { groups: [{ capacity: 6, count: 1 }], privateCount: 2 });
      expect(seats.filter((s) => s.kind === "group")).toHaveLength(1);
      expect(seats.filter((s) => s.kind === "group")[0].capacity).toBe(6);
      expect(seats.filter((s) => s.kind === "private")).toHaveLength(2);
      // グループ席から若い番号が振られる
      expect(seats.map((s) => s.number)).toEqual([1, 2, 3]);
    });

    it("SeatManager ロールを持つ人はどの拠点でも変更できる", async () => {
      await expect(svc.updateSeatConfig(seatManager, "a", { groups: [], privateCount: 3 })).resolves.toBeDefined();
    });

    it("座席管理者の追加・削除は SeatManager 以上のみ", async () => {
      await expect(svc.addSeatAdmin(member, "hq", "u02")).rejects.toThrow("権限");
      await svc.addSeatAdmin(seatManager, "hq", "u02");
      expect((await svc.seatAdmins("hq")).map((p) => p.id)).toContain("u02");
    });
  });

  describe("名刺", () => {
    it("初回ログイン時は名刺が未入力で、profileCompleted が false", async () => {
      const newUser: User = { id: "new1", email: "new1@example.co.jp", name: "新入 社員", roles: [] };
      const me = await svc.me(newUser);
      expect(me.profileCompleted).toBe(false);
      expect(me.nickname).toBe("");
      expect(me.skills).toEqual([]);
    });

    it("名刺を保存すると profileCompleted が true になる", async () => {
      const newUser: User = { id: "new2", email: "new2@example.co.jp", name: "新入 社員2", roles: [] };
      await svc.me(newUser);
      const next = await svc.updateMe(newUser, { nickname: "しんにゅう" });
      expect(next.profileCompleted).toBe(true);
    });

    it("氏名は本人が編集できる。部署など人事情報は変わらない", async () => {
      const next = await svc.updateMe(member, { fullName: "山本 賢太", nickname: "けん", dept: "eng" } as never);
      expect(next.fullName).toBe("山本 賢太");
      expect(next.nickname).toBe("けん");
      expect(next.dept).toBe("sales");
    });

    it("氏名は必須。呼ばれたい名前は空でもよい", async () => {
      await expect(svc.updateMe(member, { fullName: "  " })).rejects.toThrow("氏名");
      const next = await svc.updateMe(member, { nickname: "" });
      expect(next.nickname).toBe("");
      expect(next.profileCompleted).toBe(true);
    });
    it("アイコン画像を設定・削除できる", async () => {
      const png = "data:image/png;base64,iVBORw0KGgo=";
      const set = await svc.updateMe(member, { nickname: "けん", avatarUrl: png });
      expect(set.avatarUrl).toBe(png);
      expect((await svc.people(member)).find((p) => p.id === "u01")?.avatarUrl).toBe(png);
      const cleared = await svc.updateMe(member, { nickname: "けん", avatarUrl: "" });
      expect(cleared.avatarUrl).toBeUndefined();
    });

    it("画像以外・大きすぎるアイコンは受け付けない", async () => {
      await expect(svc.updateMe(member, { nickname: "けん", avatarUrl: "https://example.com/a.png" })).rejects.toThrow("画像");
      await expect(svc.updateMe(member, { nickname: "けん", avatarUrl: `data:image/jpeg;base64,${"A".repeat(200_001)}` })).rejects.toThrow("大きすぎ");
    });

    it("趣味を非公開にした人の趣味は他人に返さない", async () => {
      await svc.updateMe({ ...member, id: "u02" }, { showPrivate: false, nickname: "みさき" });
      const list = await svc.people(member);
      expect(list.find((p) => p.id === "u02")?.hobby).toBeUndefined();
    });
  });

  describe("声", () => {
    it("匿名の改善の声は投稿に名前を残さず、監査リストにだけ残す", async () => {
      const { post } = await svc.createPost(member, { kind: "kaizen", category: "業務の手間", body: "代車の空きが見えない", anonymous: true });
      expect(post.authorId).toBeNull();
      expect(post.assignedTo).toBe("サービス部");
      expect(await store.get("AnonymousAudit", post.id)).toMatchObject({ authorId: "u01" });
    });

    it("業務改善報告は、分野・効果・一緒に取り組んだ人つきで投稿でき、投稿者の名前が残る", async () => {
      const { post } = await svc.createPost(member, { kind: "report", category: "安全", body: "通路にラインを引いた", effect: " つまずきが減った ", branchId: "b", coAuthorIds: ["u02", "u01", "u02"] });
      expect(post).toMatchObject({ kind: "report", authorId: "u01", branchId: "b", effect: "つまずきが減った", coAuthorIds: ["u02"] });
      expect(post.status).toBeUndefined(); // 改善済みなので進み具合はない
      expect((await svc.posts("report")).map((p) => p.id)).toContain(post.id);
    });

    it("業務改善報告を改善報告書の項目で投稿すると、本文と効果は詳細から作られ、詳細も保存される", async () => {
      const report = {
        title: "納車説明のチェックシート導入", target: "店舗営業", categories: ["業務改善", "品質改善"],
        periodStart: "2026-04-01", periodEnd: "2026-04-30",
        background: "説明の漏れが月に3件あった。", cause: "担当者ごとに説明の順番が違った。", measures: "1枚のチェックシートにまとめ、全員で使うようにした。",
        result: "漏れの指摘がなくなった。", followUp: "他店にも広げる。",
      };
      const { post } = await svc.createPost(member, { kind: "report", category: "お客様対応", body: "", branchId: "b", report });
      expect(post.body).toBe("納車説明のチェックシート導入：1枚のチェックシートにまとめ、全員で使うようにした。");
      expect(post.effect).toBe("漏れの指摘がなくなった。");
      expect(post.report).toMatchObject({ title: "納車説明のチェックシート導入", categories: ["業務改善", "品質改善"], periodStart: "2026-04-01", cause: "担当者ごとに説明の順番が違った。" });
      const saved = (await svc.posts("report")).find((p) => p.id === post.id);
      expect(saved?.report?.background).toBe("説明の漏れが月に3件あった。");
    });

    it("改善報告書の必須項目が足りない・日付が不正なら、何が悪いか伝えて受け付けない", async () => {
      const ok = { title: "t", background: "b", measures: "m", result: "r", categories: [] };
      await expect(svc.createPost(member, { kind: "report", category: "安全", body: "", report: { ...ok, title: "" } })).rejects.toThrow("件名");
      await expect(svc.createPost(member, { kind: "report", category: "安全", body: "", report: { ...ok, result: "" } })).rejects.toThrow("効果");
      await expect(svc.createPost(member, { kind: "report", category: "安全", body: "", report: { ...ok, periodStart: "9月" } })).rejects.toThrow("日付");
    });
    it("業務改善報告は匿名にできず、長すぎる効果や存在しない共同者は受け付けない", async () => {
      const { post } = await svc.createPost(member, { kind: "report", category: "安全", body: "x", anonymous: true });
      expect(post.authorId).toBe("u01");
      await expect(svc.createPost(member, { kind: "report", category: "安全", body: "x", effect: "あ".repeat(81) })).rejects.toThrow("80字");
      await expect(svc.createPost(member, { kind: "report", category: "安全", body: "x", coAuthorIds: ["nobody"] })).rejects.toThrow("一緒に");
    });

    it("要改善事項に、他の拠点の人を共同者として付けると、声マップでつながる", async () => {
      await svc.seedDemoState("demo");
      await svc.createPost(member, { kind: "kaizen", category: "安全", body: "共同の提案", branchId: "e", coAuthorIds: ["v03"] });
      const links = (await svc.voiceMap()).collaborations;
      expect(links.some(([a, b]) => [a, b].includes("e") && [a, b].includes("b"))).toBe(true);
    });
    it("改善の声は投稿時に支店を選べる", async () => {
      const { post } = await svc.createPost(member, { kind: "kaizen", category: "設備", body: "テスト投稿", branchId: "a" });
      expect(post.branchId).toBe("a");
    });

    it("存在しない支店は指定できない", async () => {
      await expect(svc.createPost(member, { kind: "kaizen", category: "設備", body: "テスト投稿", branchId: "no-such-branch" })).rejects.toThrow("支店");
    });

    it("公式ニュースは PR ロールのみ投稿できる", async () => {
      await expect(svc.createPost(member, { kind: "official", category: "お知らせ", body: "動画公開しました" })).rejects.toThrow("権限");
      const { post } = await svc.createPost(pr, {
        kind: "official", category: "お知らせ", body: "動画公開しました", mediaType: "video", mediaUrl: "https://example.sharepoint.com/v.mp4",
      });
      expect(post.kind).toBe("official");
      expect(post.mediaUrl).toBe("https://example.sharepoint.com/v.mp4");
    });

    it("公式ニュースに動画ファイルをアップロードでき、配信用に読み出せる", async () => {
      const mp4 = `data:video/mp4;base64,${Buffer.from("fake-video-bytes").toString("base64")}`;
      const { post } = await svc.createPost(pr, { kind: "official", category: "お知らせ", body: "動画です", mediaDataUrl: mp4 });
      expect(post.mediaType).toBe("video");
      expect(post.mediaUrl).toMatch(/^\/api\/photos\/.+\.mp4$/);
      const file = await svc.photo(post.mediaUrl!.split("/").pop()!);
      expect(file?.contentType).toBe("video/mp4");
      expect(Buffer.from(file!.bytes).toString()).toBe("fake-video-bytes");
    });

    it("動画のアップロードは PR ロールのみ・動画以外の形式は不可", async () => {
      const mp4 = `data:video/mp4;base64,${Buffer.from("x").toString("base64")}`;
      await expect(svc.createPost(member, { kind: "official", category: "お知らせ", body: "動画です", mediaDataUrl: mp4 })).rejects.toThrow("権限");
      await expect(svc.createPost(pr, { kind: "official", category: "お知らせ", body: "動画です", mediaDataUrl: "data:video/avi;base64,AAAA" })).rejects.toThrow("MP4");
    });

    it("拍手は1人1回", async () => {
      await svc.react(member, "p1");
      await svc.react(member, "p1");
      const post = await store.get<{ reactions: number }>("Posts", "p1");
      expect(post?.reactions).toBe(25);
    });

    it("改善の声のステータス変更は KaizenOwner ロールのみ", async () => {
      await expect(svc.updateStatus(member, "k1", "done")).rejects.toThrow("権限");
      await svc.updateStatus(kaizenOwner, "k1", "done");
      const post = await store.get<{ status: string }>("Posts", "k1");
      expect(post?.status).toBe("done");
    });
  });
});
