import {
  DEFAULT_ROUTING_RULES, SEED_BRANCHES, SEED_PEOPLE, SEED_POSTS, SEED_SEATS, SEED_WISHES,
  aggregateVoiceMap, buildSeatsFromConfig, detectPii, drawSeat, routeKaizen,
  type Branch, type KaizenStatus, type Person, type Post, type PostKind,
  type RoutingRule, type Seat, type SeatConfig, type SeatOccupancy, type Wish,
} from "@tsunagari/shared";
import { randomUUID } from "node:crypto";
import { HttpError, requireRole, type User } from "./auth.js";
import { notifyUsers } from "./notify.js";
import type { DocStore } from "./store.js";

interface AuditDoc { postId: string; authorId: string; createdAt: string }

const EDITABLE_PROFILE: (keyof Person)[] = ["nickname", "skills", "hobby", "askMe", "talkOk", "showOnSeatMap", "showPrivate", "acceptWish"];

export function todayJst(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

export class Service {
  constructor(private store: DocStore) {}

  // ---------- 名刺 ----------
  async me(user: User): Promise<Person> {
    const found = await this.store.get<Person>("People", user.id);
    if (found) return found;
    // 初回利用時は Entra の情報だけを入れ、名刺は未入力のまま作る。部門・拠点は人事データ連携で上書きする想定
    const draft: Person = {
      id: user.id, fullName: user.name, email: user.email, nickname: "",
      dept: "office", unit: "", branchId: "hq", skills: [], talkOk: true,
      showOnSeatMap: true, showPrivate: false, acceptWish: true, profileCompleted: false,
    };
    await this.store.put("People", draft.id, draft.branchId, draft);
    return draft;
  }

  async isSeatAdmin(user: User, branchId: string) {
    if (user.roles.includes("Admin") || user.roles.includes("SeatManager")) return true;
    const branch = await this.store.get<Branch>("Branches", branchId);
    return !!branch?.seatAdminIds.includes(user.id);
  }

  async updateMe(user: User, patch: Partial<Person>) {
    const me = await this.me(user);
    const next = { ...me };
    for (const k of EDITABLE_PROFILE) if (k in patch) (next as Record<string, unknown>)[k] = patch[k];
    if (!next.nickname?.trim()) throw new HttpError(400, "呼ばれたい名前を入力してください");
    next.skills = (next.skills ?? []).slice(0, 5).map((s) => s.slice(0, 20));
    next.profileCompleted = true;
    await this.store.put("People", next.id, next.branchId, next);
    return next;
  }

  /** 公開設定を反映した一覧。趣味を非公開にしている人の項目は返さない */
  async people(user: User) {
    const all = await this.store.list<Person>("People");
    return all.map((p) => (p.id === user.id || p.showPrivate ? p : { ...p, hobby: undefined }));
  }

  async branches() {
    return this.store.list<Branch>("Branches");
  }

  // ---------- 座席の設定 ----------
  async seatConfig(branchId: string) {
    const branch = await this.store.get<Branch>("Branches", branchId);
    if (!branch) throw new HttpError(404, "拠点が見つかりません");
    return branch.seatConfig;
  }

  async updateSeatConfig(user: User, branchId: string, config: SeatConfig) {
    if (!(await this.isSeatAdmin(user, branchId))) throw new HttpError(403, "この拠点の座席を編集する権限がありません");
    if (config.groups.some((g) => g.capacity < 2 || g.count < 0) || config.privateCount < 0) {
      throw new HttpError(400, "座席の人数・数の指定が正しくありません");
    }
    const branch = await this.store.get<Branch>("Branches", branchId);
    if (!branch) throw new HttpError(404, "拠点が見つかりません");
    const floor = (await this.store.list<Seat>("Seats", branchId))[0]?.floor ?? "1F";
    for (const s of await this.store.list<Seat>("Seats", branchId)) await this.store.remove("Seats", s.id);
    const today = todayJst();
    for (const o of await this.store.list<SeatOccupancy>("Assignments", branchId)) {
      if (o.date === today) await this.store.remove("Assignments", `${o.seatId}:${o.date}`);
    }
    const seats = buildSeatsFromConfig(branchId, floor, config);
    for (const s of seats) await this.store.put("Seats", s.id, branchId, s);
    await this.store.put<Branch>("Branches", branchId, "all", { ...branch, seatConfig: config });
    return seats;
  }

  async seatAdmins(branchId: string) {
    const branch = await this.store.get<Branch>("Branches", branchId);
    if (!branch) throw new HttpError(404, "拠点が見つかりません");
    const people = await this.store.list<Person>("People");
    const byId = new Map(people.map((p) => [p.id, p]));
    return branch.seatAdminIds.map((id) => byId.get(id)).filter((p): p is Person => !!p);
  }

  async addSeatAdmin(user: User, branchId: string, personId: string) {
    requireRole(user, "SeatManager");
    const branch = await this.store.get<Branch>("Branches", branchId);
    if (!branch) throw new HttpError(404, "拠点が見つかりません");
    if (!branch.seatAdminIds.includes(personId)) {
      await this.store.put<Branch>("Branches", branchId, "all", { ...branch, seatAdminIds: [...branch.seatAdminIds, personId] });
    }
  }

  async removeSeatAdmin(user: User, branchId: string, personId: string) {
    requireRole(user, "SeatManager");
    const branch = await this.store.get<Branch>("Branches", branchId);
    if (!branch) throw new HttpError(404, "拠点が見つかりません");
    await this.store.put<Branch>("Branches", branchId, "all", { ...branch, seatAdminIds: branch.seatAdminIds.filter((id) => id !== personId) });
  }

  // ---------- 座席（着席） ----------
  private async occupancyToday(branchId: string): Promise<Map<string, SeatOccupancy>> {
    const today = todayJst();
    const docs = await this.store.list<SeatOccupancy>("Assignments", branchId);
    return new Map(docs.filter((d) => d.date === today).map((d) => [d.seatId, d]));
  }

  async floor(user: User, branchId?: string) {
    const me = await this.me(user);
    const bid = branchId ?? me.branchId;
    const [branches, seats, occupancy, people] = await Promise.all([
      this.store.list<Branch>("Branches"),
      this.store.list<Seat>("Seats", bid),
      this.occupancyToday(bid),
      this.store.list<Person>("People"),
    ]);
    const branch = branches.find((b) => b.id === bid);
    if (!branch) throw new HttpError(404, "拠点が見つかりません");
    const hidden = new Set(people.filter((p) => !p.showOnSeatMap && p.id !== user.id).map((p) => p.id));
    const assignments: Record<string, string[]> = {};
    for (const s of seats) assignments[s.id] = (occupancy.get(s.id)?.personIds ?? []).filter((id) => !hidden.has(id));
    return { branch, seats, assignments };
  }

  /** その日の自分の席を離れる。どの拠点で着席していても解除できる */
  async checkOut(user: User) {
    const today = todayJst();
    const all = await this.store.list<SeatOccupancy>("Assignments");
    const mine = all.find((o) => o.date === today && o.personIds.includes(user.id));
    if (!mine) return;
    const nextIds = mine.personIds.filter((id) => id !== user.id);
    if (nextIds.length > 0) await this.store.put<SeatOccupancy>("Assignments", `${mine.seatId}:${mine.date}`, mine.branchId, { ...mine, personIds: nextIds });
    else await this.store.remove("Assignments", `${mine.seatId}:${mine.date}`);
  }

  /** QRコード・手入力で特定の席に着席する（集中席・固定席など、自分で席を選びたい場合） */
  async checkIn(user: User, seatCode: string) {
    if (!seatCode) throw new HttpError(400, "席番号を指定してください");
    const me = await this.me(user);
    const seats = await this.store.list<Seat>("Seats");
    const code = seatCode.trim().toUpperCase();
    const seat = seats.find((s) => s.id.toUpperCase() === code) ??
      seats.find((s) => s.branchId === me.branchId && s.label.toUpperCase() === code);
    if (!seat) throw new HttpError(404, `席「${seatCode}」が見つかりません。机のQRコードの下にある席番号を確認してください`);
    await this.checkOut(user);
    const today = todayJst();
    const existing = await this.store.get<SeatOccupancy>("Assignments", `${seat.id}:${today}`);
    const occupants = existing?.personIds ?? [];
    if (occupants.length >= seat.capacity) throw new HttpError(409, "この席は満席です");
    await this.store.put<SeatOccupancy>("Assignments", `${seat.id}:${today}`, seat.branchId, {
      branchId: seat.branchId, seatId: seat.id, date: today, personIds: [...occupants, me.id],
    });
    return { seat };
  }

  /** ホーム画面の「抽選する」。自分の拠点内でランダムに席を割り当てる */
  async draw(user: User) {
    const me = await this.me(user);
    await this.checkOut(user);
    const [seats, occupancyMap, wishes] = await Promise.all([
      this.store.list<Seat>("Seats", me.branchId),
      this.occupancyToday(me.branchId),
      this.store.list<Wish>("Wishes", me.branchId),
    ]);
    const occupancy: Record<string, string[]> = {};
    for (const [seatId, doc] of occupancyMap) occupancy[seatId] = doc.personIds;
    const result = drawSeat({ seats, occupancy, personId: me.id, wishes });
    if (!result) throw new HttpError(409, "現在、空いている席がありません。しばらくしてから再度お試しください");
    const seat = seats.find((s) => s.id === result.seatId)!;
    const today = todayJst();
    const existing = await this.store.get<SeatOccupancy>("Assignments", `${seat.id}:${today}`);
    await this.store.put<SeatOccupancy>("Assignments", `${seat.id}:${today}`, seat.branchId, {
      branchId: seat.branchId, seatId: seat.id, date: today, personIds: [...(existing?.personIds ?? []), me.id],
    });
    return { seat };
  }

  /** 退勤時刻に全員の着席を解除（タイマーから呼ぶ） */
  async checkOutEveryone() {
    const today = todayJst();
    const all = await this.store.list<SeatOccupancy>("Assignments");
    let n = 0;
    for (const o of all.filter((x) => x.date === today)) {
      await this.store.remove("Assignments", `${o.seatId}:${o.date}`);
      n += o.personIds.length;
    }
    return n;
  }

  async addWish(user: User, toId: string) {
    const me = await this.me(user);
    if (toId === me.id) throw new HttpError(400, "自分自身は選べません");
    const target = await this.store.get<Person>("People", toId);
    if (!target) throw new HttpError(404, "相手が見つかりません");
    if (!target.acceptWish) throw new HttpError(400, "この人は現在リクエストを受け付けていません");
    // 1人1件：同じキーで上書き。相手には通知しない
    await this.store.put<Wish>("Wishes", `${me.branchId}:${me.id}`, me.branchId, { fromId: me.id, toId });
  }

  // ---------- 声 ----------
  async posts(kind: PostKind) {
    const list = await this.store.list<Post>("Posts", kind);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }

  async createPost(user: User, input: {
    kind: PostKind; category: string; body: string; anonymous?: boolean; photoDataUrl?: string;
    branchId?: string; mediaType?: "image" | "video"; mediaUrl?: string;
  }) {
    const me = await this.me(user);
    if (!["hitokoto", "kaizen", "official"].includes(input.kind)) throw new HttpError(400, "投稿の種類が不正です");
    if (input.kind === "official") requireRole(user, "PR");

    const body = (input.body ?? "").trim();
    if (!body) throw new HttpError(400, "本文を入力してください");
    const maxLen = input.kind === "official" ? 500 : 140;
    if (body.length > maxLen) throw new HttpError(400, `${maxLen}字以内で入力してください`);
    const anonymous = input.kind === "kaizen" && !!input.anonymous;
    const id = randomUUID();

    let branchId = me.branchId;
    if (input.kind === "kaizen" && input.branchId) {
      const branches = await this.store.list<Branch>("Branches");
      if (!branches.some((b) => b.id === input.branchId)) throw new HttpError(400, "支店の指定が正しくありません");
      branchId = input.branchId;
    }

    let photoUrl: string | undefined;
    if (input.photoDataUrl && input.kind === "hitokoto") {
      const m = /^data:(image\/(png|jpeg));base64,(.+)$/.exec(input.photoDataUrl);
      if (!m) throw new HttpError(400, "写真は PNG または JPEG にしてください");
      const bytes = Buffer.from(m[3], "base64");
      if (bytes.length > 4 * 1024 * 1024) throw new HttpError(400, "写真は4MB以下にしてください");
      const name = `${id}.${m[2] === "png" ? "png" : "jpg"}`;
      await this.store.savePhoto(name, bytes, m[1]);
      photoUrl = `/api/photos/${name}`;
    }

    let mediaUrl: string | undefined;
    if (input.kind === "official" && input.mediaUrl) {
      if (!/^https:\/\//.test(input.mediaUrl)) throw new HttpError(400, "動画・画像のリンクは https:// から始まるURLにしてください");
      mediaUrl = input.mediaUrl;
    }

    const rules = await this.routingRules();
    const post: Post = {
      id, kind: input.kind, category: input.category, body, photoUrl,
      authorId: anonymous ? null : me.id, authorDept: anonymous ? null : me.dept,
      branchId, createdAt: new Date().toISOString(), reactions: 0,
      ...(mediaUrl ? { mediaType: input.mediaType ?? "video", mediaUrl } : {}),
      ...(input.kind === "kaizen" ? { status: "received" as const, assignedTo: routeKaizen(body, input.category, rules).department } : {}),
    };
    await this.store.put("Posts", id, input.kind, post);
    // 匿名投稿の投稿者は、閲覧を管理者に限定した監査リストにだけ保存する（要件定義書 11章 匿名性）
    if (anonymous) await this.store.put<AuditDoc>("AnonymousAudit", id, "audit", { postId: id, authorId: me.id, createdAt: post.createdAt });
    return { post, piiWarnings: detectPii(body) };
  }

  async react(user: User, postId: string) {
    const key = `${postId}:${user.id}`;
    if (await this.store.get("Reactions", key)) return; // 1人1回
    const post = await this.store.get<Post>("Posts", postId);
    if (!post) throw new HttpError(404, "投稿が見つかりません");
    await this.store.put("Reactions", key, postId, { postId, personId: user.id });
    await this.store.put("Posts", postId, post.kind, { ...post, reactions: post.reactions + 1 });
  }

  async updateStatus(user: User, postId: string, status: KaizenStatus, assignedTo?: string) {
    requireRole(user, "KaizenOwner");
    const post = await this.store.get<Post>("Posts", postId);
    if (!post || post.kind !== "kaizen") throw new HttpError(404, "改善の声が見つかりません");
    const next: Post & { statusChangedAt?: string } = { ...post, status, assignedTo: assignedTo ?? post.assignedTo, statusChangedAt: new Date().toISOString() };
    await this.store.put("Posts", postId, "kaizen", next);
    if (post.authorId) await notifyUsers([post.authorId], "kaizenUpdated", `あなたの改善の声が「${status}」になりました`, { status });
  }

  async pickForNews(user: User, postId: string) {
    requireRole(user, "PR");
    const post = await this.store.get<Post>("Posts", postId);
    if (!post || post.kind !== "hitokoto") throw new HttpError(404, "投稿が見つかりません");
    await this.store.put("Posts", postId, "hitokoto", { ...post, pickedForNews: true });
  }

  /** 一定日数ステータスが動いていない改善の声（タイマーから呼び、担当者へ督促） */
  async staleKaizen(days: number) {
    const list = await this.store.list<Post & { statusChangedAt?: string }>("Posts", "kaizen");
    const limit = Date.now() - days * 86400_000;
    return list.filter((p) => p.status !== "done" && new Date(p.statusChangedAt ?? p.createdAt).getTime() < limit);
  }

  async voiceMap() {
    const [branches, posts, people] = await Promise.all([
      this.store.list<Branch>("Branches"), this.store.list<Post>("Posts"), this.store.list<Person>("People"),
    ]);
    const since = Date.now() - 31 * 86400_000; // 直近1か月
    return aggregateVoiceMap(branches, posts.filter((p) => new Date(p.createdAt).getTime() >= since), people);
  }

  photo(name: string) {
    if (!/^[\w-]+\.(png|jpg)$/.test(name)) throw new HttpError(400, "不正なファイル名です");
    return this.store.readPhoto(name);
  }

  private async routingRules(): Promise<RoutingRule[]> {
    const rules = await this.store.list<RoutingRule>("RoutingRules");
    return rules.length ? rules : DEFAULT_ROUTING_RULES;
  }

  // ---------- 開発用 ----------
  async seed() {
    for (const b of SEED_BRANCHES) await this.store.put("Branches", b.id, "all", b);
    for (const p of SEED_PEOPLE) await this.store.put("People", p.id, p.branchId, p);
    for (const s of SEED_SEATS) await this.store.put("Seats", s.id, s.branchId, s);
    for (const w of SEED_WISHES) await this.store.put("Wishes", `hq:${w.fromId}`, "hq", w);
    for (const p of SEED_POSTS) await this.store.put("Posts", p.id, p.kind, p);
    for (const r of DEFAULT_ROUTING_RULES) await this.store.put("RoutingRules", r.department, "all", r);
  }
}
