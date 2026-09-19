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

const EDITABLE_PROFILE: (keyof Person)[] = ["nickname", "skills", "hobby", "askMe", "talkOk", "showOnSeatMap", "showPrivate", "acceptWish", "avatarUrl"];
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX_LENGTH = 200_000; // data URL の文字数。256px角に切り抜いた JPEG なら 30〜50KB 程度
const MEDIA_PATTERN = /^data:((?:image\/(?:png|jpeg))|(?:video\/(?:mp4|webm)));base64,(.+)$/;
const MEDIA_MAX_BYTES = 30 * 1024 * 1024;
const MEDIA_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4", "video/webm": "webm" };

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
    if (next.avatarUrl) {
      if (next.avatarUrl.length > AVATAR_MAX_LENGTH) throw new HttpError(400, "アイコン画像が大きすぎます。別の画像を選んでください");
      if (!AVATAR_PATTERN.test(next.avatarUrl)) throw new HttpError(400, "アイコンは PNG・JPEG・WebP の画像にしてください");
    } else {
      delete next.avatarUrl; // 空文字はアイコンの削除
    }
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
    const validInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
    if (
      !Array.isArray(config?.groups) ||
      config.groups.some((g) => !validInt(g.capacity, 2, 20) || !validInt(g.count, 0, 100)) ||
      !validInt(config.privateCount, 0, 200)
    ) {
      throw new HttpError(400, "座席の指定が正しくありません（グループ席は2〜20人、数は0〜100、プライベート席は0〜200）");
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

  /** 拠点の座席。まだ作られていなければ（本社以外は初期データに座席がない）、座席設定から生成して保存する */
  private async seatsOf(branchId: string): Promise<Seat[]> {
    const seats = await this.store.list<Seat>("Seats", branchId);
    if (seats.length > 0) return seats;
    const branch = await this.store.get<Branch>("Branches", branchId);
    if (!branch?.seatConfig) return seats;
    const built = buildSeatsFromConfig(branchId, branchId === "hq" ? "2F" : "1F", branch.seatConfig);
    for (const s of built) await this.store.put("Seats", s.id, branchId, s);
    return built;
  }

  async floor(user: User, branchId?: string) {
    const me = await this.me(user);
    const bid = branchId ?? me.branchId;
    const seats = await this.seatsOf(bid);
    const [branches, occupancy, people] = await Promise.all([
      this.store.list<Branch>("Branches"),
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

  /** ホーム画面の「抽選する」。選んだ支店（省略時は所属支店）の中でランダムに席を割り当てる。押したときだけ実行される */
  async draw(user: User, branchId?: string) {
    const me = await this.me(user);
    const bid = branchId || me.branchId;
    if (!(await this.store.get<Branch>("Branches", bid))) throw new HttpError(400, "支店の指定が正しくありません");
    const seats = await this.seatsOf(bid);
    const [occupancyMap, wishes] = await Promise.all([
      this.occupancyToday(bid),
      this.store.list<Wish>("Wishes", me.branchId),
    ]);
    // 自分が今座っている席は空きとして数える（引き直しても、空きがなければ元の席のまま残す）
    const occupancy: Record<string, string[]> = {};
    for (const [seatId, doc] of occupancyMap) occupancy[seatId] = doc.personIds.filter((id) => id !== me.id);
    const result = drawSeat({ seats, occupancy, personId: me.id, wishes });
    if (!result) throw new HttpError(409, "現在、空いている席がありません。しばらくしてから再度お試しください");
    await this.checkOut(user);
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
    branchId?: string; mediaType?: "image" | "video"; mediaUrl?: string; mediaDataUrl?: string;
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
    let mediaType = input.mediaType;
    if (input.kind === "official" && input.mediaDataUrl) {
      const m = MEDIA_PATTERN.exec(input.mediaDataUrl);
      if (!m) throw new HttpError(400, "動画は MP4・WebM、画像は PNG・JPEG にしてください");
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length > MEDIA_MAX_BYTES) throw new HttpError(400, "ファイルは30MB以下にしてください");
      const name = `${id}.${MEDIA_EXT[m[1]]}`;
      await this.store.savePhoto(name, bytes, m[1]);
      mediaUrl = `/api/photos/${name}`;
      mediaType = m[1].startsWith("video/") ? "video" : "image";
    } else if (input.kind === "official" && input.mediaUrl) {
      if (!/^https:\/\//.test(input.mediaUrl)) throw new HttpError(400, "動画・画像のリンクは https:// から始まるURLにしてください");
      mediaUrl = input.mediaUrl;
    }

    const rules = await this.routingRules();
    const post: Post = {
      id, kind: input.kind, category: input.category, body, photoUrl,
      authorId: anonymous ? null : me.id, authorDept: anonymous ? null : me.dept,
      branchId, createdAt: new Date().toISOString(), reactions: 0,
      ...(mediaUrl ? { mediaType: mediaType ?? "video", mediaUrl } : {}),
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
    if (!/^[\w-]+\.(png|jpg|mp4|webm)$/.test(name)) throw new HttpError(400, "不正なファイル名です");
    return this.store.readPhoto(name);
  }

  private async routingRules(): Promise<RoutingRule[]> {
    const rules = await this.store.list<RoutingRule>("RoutingRules");
    return rules.length ? rules : DEFAULT_ROUTING_RULES;
  }

  // ---------- 開発用 ----------
  /**
   * デモ表示用：本社の座席を今日の分だけ埋め、デモ利用者の名刺を記入済みにする。
   * seed() とは別にしてあるのは、テストが「空のフロア」を前提にしているため。
   * すでに今日の着席があれば何もしない（冪等）。
   */
  async seedDemoState(demoUserId: string) {
    if (!(await this.store.get<Person>("People", demoUserId))) {
      const demo: Person = {
        id: demoUserId, fullName: "田中 太郎", email: `${demoUserId}@example.co.jp`, nickname: "たろう",
        dept: "sales", unit: "店舗営業", branchId: "hq", skills: ["初めての車選び", "ファミリー層"],
        hobby: "週末は子どもと公園", askMe: "新車の見積り、一緒に考えます", talkOk: true,
        showOnSeatMap: true, showPrivate: true, acceptWish: true, profileCompleted: true,
      };
      await this.store.put("People", demo.id, demo.branchId, demo);
    }
    await this.seedDemoVoices();
    if ((await this.occupancyToday("hq")).size > 0) return;
    const today = todayJst();
    const seatByNumber = new Map(SEED_SEATS.map((s) => [s.number, s]));
    const layout: [number, string[]][] = [
      [1, ["u01", "u02", "u04"]],
      [2, ["u07", "u10", "u11", "u08"]],
      [3, ["u03", "u05"]],
      [4, ["u06"]],
      [5, ["u09"]],
      [6, ["u12"]],
    ];
    for (const [number, ids] of layout) {
      const seat = seatByNumber.get(number)!;
      const personIds = ids.filter((id) => id !== demoUserId);
      if (personIds.length === 0) continue;
      await this.store.put<SeatOccupancy>("Assignments", `${seat.id}:${today}`, seat.branchId, {
        branchId: seat.branchId, seatId: seat.id, date: today, personIds,
      });
    }
  }

  /** デモ表示用：各支店の社員と、直近1か月の投稿（声マップに拠点ごとの色・つながりが出る量）を入れる */
  private async seedDemoVoices() {
    if (await this.store.get<Post>("Posts", "demo-h01")) return;
    const P = (id: string, fullName: string, nickname: string, dept: Person["dept"], unit: string, branchId: string, skills: string[]): Person => ({
      id, fullName, email: `${id}@example.co.jp`, nickname, dept, unit, branchId, skills, talkOk: true,
      showOnSeatMap: true, showPrivate: false, acceptWish: true, profileCompleted: true,
    });
    const people: Person[] = [
      P("v01", "佐藤 実", "みのる", "sales", "店舗営業", "a", ["新車提案"]),
      P("v02", "鈴木 遥", "はる", "eng", "サービス部", "a", ["点検", "タイヤ"]),
      P("v03", "高橋 恵", "めぐ", "sales", "店舗営業", "b", ["リース"]),
      P("v04", "伊藤 剛", "つよし", "eng", "サービス部", "b", ["EV診断"]),
      P("v05", "渡辺 進", "すすむ", "eng", "板金", "c", ["板金"]),
      P("v06", "山田 栞", "しおり", "sales", "U-Car", "c", ["査定"]),
      P("v07", "中村 蓮", "れん", "sales", "店舗営業", "d", ["ファミリー層"]),
      P("v08", "小川 誠", "まこと", "eng", "サービス部", "d", ["車検"]),
      P("v09", "加藤 優", "ゆう", "sales", "店舗営業", "e", ["初めての車選び"]),
      P("v10", "吉田 巧", "たくみ", "eng", "サービス部", "e", ["整備説明"]),
    ];
    for (const p of people) await this.store.put("People", p.id, p.branchId, p);
    const dept = new Map([...people, ...SEED_PEOPLE].map((p) => [p.id, p.dept]));

    // [id, 種類, 投稿者, 支店, カテゴリ, 本文, 拍手, 何日前, 改善の声の状態, 担当, 共同提案者]
    type Row = [string, PostKind, string, string, string, string, number, number, KaizenStatus?, string?, string[]?];
    const rows: Row[] = [
      ["h01", "hitokoto", "v01", "a", "お客様の笑顔", "納車のとき、お子さんが車に手を振ってくれました。", 14, 1],
      ["h02", "hitokoto", "v02", "a", "できごと", "朝礼でタイヤの溝の見方を共有しました。営業さんもメモを取ってくれました。", 9, 3],
      ["h03", "hitokoto", "v03", "b", "ありがとう", "在庫確認、サービスの方がすぐ返してくれて助かりました。", 11, 2],
      ["h04", "hitokoto", "v04", "b", "レース・イベント", "社内チームのサーキット走行会、参加者が去年の倍になりました。", 21, 5],
      ["h05", "hitokoto", "v04", "b", "できごと", "EV充電の相談会を開きました。10組のお客様が来てくださいました。", 17, 8],
      ["h06", "hitokoto", "v05", "c", "できごと", "板金の仕上がりを、お客様に工程の写真で見ていただきました。", 12, 4],
      ["h07", "hitokoto", "v06", "c", "お客様の笑顔", "査定額の理由を丁寧に説明したら、納得して次の車もうちでと言っていただけました。", 25, 6],
      ["h08", "hitokoto", "v07", "d", "できごと", "店頭のキッズスペースを模様替えしました。", 8, 2],
      ["h09", "hitokoto", "v08", "d", "ありがとう", "夜遅くの急な点検、営業さんが先にお客様へ連絡してくれて助かりました。", 15, 9],
      ["h10", "hitokoto", "v09", "e", "お客様の笑顔", "初めて車を買うお客様が「ここで良かった」と言ってくれました。", 19, 1],
      ["h11", "hitokoto", "v10", "e", "できごと", "整備の待ち時間に見られる、作業の動画を作ってみました。", 13, 7],
      ["h12", "hitokoto", "u12", "hq", "できごと", "経費精算のよくある質問を、社内ポータルにまとめました。", 6, 10],
      ["k01", "kaizen", "v07", "d", "業務の手間", "営業が代車の空きを電話で確認している。サービスと同じ画面で見られると助かる。", 22, 12, "inProgress", "サービス部", ["v04"]],
      ["k02", "kaizen", "v02", "a", "お客様対応", "点検の説明を、営業とエンジニアが一緒にお客様へ伝える場を作りたい。", 16, 15, "reviewing", "サービス部", ["v06"]],
      ["k03", "kaizen", "v09", "e", "お客様対応", "納車前の最終確認を、営業とサービスで同じチェック表にしたい。", 12, 6, "received", "サービス部", ["v10"]],
      ["k04", "kaizen", "v05", "c", "設備", "板金ブースの換気が足りず、夏場に作業しづらい。", 9, 20, "done", "総務"],
      ["k05", "kaizen", "v03", "b", "業務の手間", "リース契約の書類を、店舗ごとに別々に管理している。共通の置き場が欲しい。", 14, 11, "inProgress", "営業企画"],
      ["k06", "kaizen", "v01", "a", "安全", "店の駐車場の出入口が見えにくく、ひやりとした。ミラーをつけたい。", 18, 4, "received", "安全衛生委員会"],
      ["k07", "kaizen", "v08", "d", "設備", "工具の置き場が足りない。共用の棚を増やしたい。", 7, 25, "done", "総務"],
    ];
    const now = Date.now();
    for (const [id, kind, authorId, branchId, category, body, reactions, daysAgo, status, assignedTo, coAuthorIds] of rows) {
      const post: Post & { statusChangedAt?: string } = {
        id: `demo-${id}`, kind, authorId, authorDept: dept.get(authorId) ?? null, branchId, category, body, reactions,
        createdAt: new Date(now - daysAgo * 86400_000).toISOString(),
        ...(kind === "kaizen" ? { status, assignedTo, ...(coAuthorIds ? { coAuthorIds } : {}) } : {}),
      };
      await this.store.put("Posts", post.id, kind, post);
    }
  }

  async seed() {
    for (const b of SEED_BRANCHES) await this.store.put("Branches", b.id, "all", b);
    for (const p of SEED_PEOPLE) await this.store.put("People", p.id, p.branchId, p);
    for (const s of SEED_SEATS) await this.store.put("Seats", s.id, s.branchId, s);
    for (const w of SEED_WISHES) await this.store.put("Wishes", `hq:${w.fromId}`, "hq", w);
    for (const p of SEED_POSTS) await this.store.put("Posts", p.id, p.kind, p);
    for (const r of DEFAULT_ROUTING_RULES) await this.store.put("RoutingRules", r.department, "all", r);
  }
}
