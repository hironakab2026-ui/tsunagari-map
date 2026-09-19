import { beforeEach, describe, expect, it } from "vitest";
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

    it("グループ席が全て満席ならプライベート席に割り当てる", async () => {
      // hq: グループ席3つ×定員4人 = 12人分埋める
      const fillers = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, email: "", name: `f${i}`, roles: [] }) as User);
      for (const f of fillers) await svc.draw(f);
      const { seat } = await svc.draw(member);
      expect(seat.kind).toBe("private");
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

    it("声マップに全支店の投稿と、支店をまたぐ共同提案が出る", async () => {
      await svc.seedDemoState("demo");
      const map = await svc.voiceMap();
      expect(map.stats.every((s) => s.sales + s.eng + s.office > 0)).toBe(true);
      expect(map.collaborations.some(([a, b]) => a !== b)).toBe(true);
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

    it("名刺では部署や氏名など編集不可の項目は変わらない", async () => {
      const next = await svc.updateMe(member, { nickname: "けん", dept: "eng", fullName: "偽名" } as never);
      expect(next.nickname).toBe("けん");
      expect(next.dept).toBe("sales");
      expect(next.fullName).toBe("山本 健太");
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
