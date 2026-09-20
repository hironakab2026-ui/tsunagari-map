import {
  DEFAULT_ROUTING_RULES, SEED_BRANCHES, SEED_PEOPLE, SEED_POSTS, SEED_SEATS,
  CHAT_MAX_LENGTH, aggregateVoiceMap, buildSeatsFromConfig, detectPii, drawSeat, isOnline, routeKaizen, threadIdOf,
  type Branch, type ChatMessage, type ChatThread, type KaizenStatus, type Person, type Post, type PostKind,
  type RoutingRule, type Seat, type SeatConfig, type SeatOccupancy, type SharedTask,
} from "@tsunagari/shared";
import { randomUUID } from "node:crypto";
import { HttpError, requireRole, type User } from "./auth.js";
import { notifyUsers } from "./notify.js";
import type { DocStore } from "./store.js";

interface AuditDoc { postId: string; authorId: string; createdAt: string }

const EDITABLE_PROFILE: (keyof Person)[] = ["fullName", "nickname", "skills", "hobby", "askMe", "talkOk", "showOnSeatMap", "showPrivate", "avatarUrl"];
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
      showOnSeatMap: true, showPrivate: false, profileCompleted: false,
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
    next.fullName = (next.fullName ?? "").trim();
    if (!next.fullName) throw new HttpError(400, "氏名を入力してください");
    if (next.fullName.length > 30) throw new HttpError(400, "氏名は30字以内で入力してください");
    next.nickname = (next.nickname ?? "").trim().slice(0, 12); // 自己紹介の一項目。空でもよい
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

  /** 公開設定を反映した一覧。趣味を非公開にしている人の項目は返さない。online は、最近アプリを開いている、または今日着席中の人 */
  async people(user: User) {
    const [all, occupancy] = await Promise.all([this.store.list<Person>("People"), this.store.list<SeatOccupancy>("Assignments")]);
    const today = todayJst();
    const seated = new Set(occupancy.filter((o) => o.date === today).flatMap((o) => o.personIds));
    const now = Date.now();
    return all.map((p) => {
      const shown = p.id === user.id || p.showPrivate ? p : { ...p, hobby: undefined };
      return { ...shown, online: p.id === user.id || seated.has(p.id) || isOnline(p.lastSeenAt, now) };
    });
  }

  /** アプリを開いている間、定期的に呼ばれる。最終利用時刻を更新する（書き込みを減らすため、1分以内は更新しない） */
  async heartbeat(user: User) {
    const me = await this.me(user);
    if (me.lastSeenAt && Date.now() - new Date(me.lastSeenAt).getTime() < 60_000) return;
    await this.store.put("People", me.id, me.branchId, { ...me, lastSeenAt: new Date().toISOString() });
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
    const occupancyMap = await this.occupancyToday(bid);
    // 自分が今座っている席は空きとして数える（引き直しても、空きがなければ元の席のまま残す）
    const occupancy: Record<string, string[]> = {};
    for (const [seatId, doc] of occupancyMap) occupancy[seatId] = doc.personIds.filter((id) => id !== me.id);
    const result = drawSeat({ seats, occupancy, personId: me.id });
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

  // ---------- 共有タスク（全体へのアナウンス） ----------
  /** 新しい順。total は完了率の分母（登録されている人数） */
  async tasks(user: User) {
    const [list, people] = await Promise.all([this.store.list<SharedTask>("Tasks"), this.store.list<Person>("People")]);
    const total = people.length;
    return list
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((t) => ({ ...t, doneBy: undefined, doneCount: t.doneBy.length, done: t.doneBy.includes(user.id), total }));
  }

  async createTask(user: User, input: { title: string; body?: string; dueDate?: string }) {
    requireRole(user, "PR");
    const title = (input.title ?? "").trim();
    if (!title) throw new HttpError(400, "タイトルを入力してください");
    if (title.length > 60) throw new HttpError(400, "タイトルは60字以内にしてください");
    const body = (input.body ?? "").trim();
    if (body.length > 300) throw new HttpError(400, "詳細は300字以内にしてください");
    if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new HttpError(400, "期限の日付が正しくありません");
    const task: SharedTask = {
      id: randomUUID(), title, ...(body ? { body } : {}), ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      createdBy: user.id, createdAt: new Date().toISOString(), doneBy: [],
    };
    await this.store.put("Tasks", task.id, "all", task);
    return task;
  }

  /** 自分の「完了」をつけ外しする */
  async setTaskDone(user: User, taskId: string, done: boolean) {
    const task = await this.store.get<SharedTask>("Tasks", taskId);
    if (!task) throw new HttpError(404, "タスクが見つかりません");
    const doneBy = task.doneBy.filter((id) => id !== user.id);
    if (done) doneBy.push(user.id);
    await this.store.put("Tasks", taskId, "all", { ...task, doneBy });
  }

  async deleteTask(user: User, taskId: string) {
    requireRole(user, "PR");
    await this.store.remove("Tasks", taskId);
  }

  // ---------- アプリ内チャット（1対1） ----------
  async sendMessage(user: User, toId: string, body: string) {
    const me = await this.me(user);
    if (toId === me.id) throw new HttpError(400, "自分には送れません");
    if (!(await this.store.get<Person>("People", toId))) throw new HttpError(404, "相手が見つかりません");
    const text = (body ?? "").trim();
    if (!text) throw new HttpError(400, "メッセージを入力してください");
    if (text.length > CHAT_MAX_LENGTH) throw new HttpError(400, `${CHAT_MAX_LENGTH}字以内で入力してください`);
    const threadId = threadIdOf(me.id, toId);
    const msg: ChatMessage = { id: `${Date.now()}-${randomUUID().slice(0, 8)}`, threadId, fromId: me.id, toId, body: text, createdAt: new Date().toISOString() };
    await this.store.put("Messages", msg.id, threadId, msg);
    return msg;
  }

  /** 相手との会話を古い順に返す。自分宛ての未読は、ここで既読にする */
  async messages(user: User, withId: string) {
    const list = (await this.store.list<ChatMessage>("Messages", threadIdOf(user.id, withId))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const now = new Date().toISOString();
    for (const m of list) {
      if (m.toId === user.id && !m.readAt) {
        m.readAt = now;
        await this.store.put("Messages", m.id, m.threadId, m);
      }
    }
    return list.slice(-200);
  }

  /** 自分が関わる会話の一覧（新しい順）。unread は自分宛ての未読数 */
  async chatThreads(user: User): Promise<ChatThread[]> {
    const all = (await this.store.list<ChatMessage>("Messages")).filter((m) => m.fromId === user.id || m.toId === user.id);
    const byPeer = new Map<string, ChatThread>();
    for (const m of all) {
      const peer = m.fromId === user.id ? m.toId : m.fromId;
      const cur = byPeer.get(peer) ?? { personId: peer, last: m, unread: 0 };
      if (m.createdAt > cur.last.createdAt) cur.last = m;
      if (m.toId === user.id && !m.readAt) cur.unread++;
      byPeer.set(peer, cur);
    }
    return [...byPeer.values()].sort((a, b) => b.last.createdAt.localeCompare(a.last.createdAt));
  }

  // ---------- ギャラリー ----------
  /** 投稿された写真（ひとこと・公式）を新しい順に。ホームのスライドショー用 */
  async gallery() {
    const posts = await this.store.list<Post>("Posts");
    return posts
      .flatMap((p) => {
        const url = p.photoUrl ?? (p.mediaType === "image" ? p.mediaUrl : undefined);
        return url && p.kind !== "kaizen" ? [{ id: p.id, url, caption: p.body, authorId: p.authorId, createdAt: p.createdAt }] : [];
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);
  }
  // ---------- 声 ----------
  async posts(kind: PostKind) {
    const list = await this.store.list<Post>("Posts", kind);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }

  async createPost(user: User, input: {
    kind: PostKind; category: string; body: string; anonymous?: boolean; photoDataUrl?: string;
    branchId?: string; mediaType?: "image" | "video"; mediaUrl?: string; mediaDataUrl?: string;
    effect?: string; coAuthorIds?: string[];
  }) {
    const me = await this.me(user);
    if (!["hitokoto", "kaizen", "report", "official"].includes(input.kind)) throw new HttpError(400, "投稿の種類が不正です");
    if (input.kind === "official") requireRole(user, "PR");

    const body = (input.body ?? "").trim();
    if (!body) throw new HttpError(400, "本文を入力してください");
    const maxLen = input.kind === "official" ? 500 : input.kind === "report" ? 200 : 140;
    if (body.length > maxLen) throw new HttpError(400, `${maxLen}字以内で入力してください`);
    const anonymous = input.kind === "kaizen" && !!input.anonymous;
    const id = randomUUID();

    let branchId = me.branchId;
    const isVoice = input.kind === "kaizen" || input.kind === "report"; // 声マップの対象
    if (isVoice && input.branchId) {
      const branches = await this.store.list<Branch>("Branches");
      if (!branches.some((b) => b.id === input.branchId)) throw new HttpError(400, "支店の指定が正しくありません");
      branchId = input.branchId;
    }

    let effect: string | undefined;
    if (input.kind === "report") {
      effect = (input.effect ?? "").trim();
      if (effect.length > 80) throw new HttpError(400, "効果は80字以内で入力してください");
    }
    let coAuthorIds: string[] | undefined;
    if (isVoice && input.coAuthorIds?.length) {
      const ids = [...new Set(input.coAuthorIds)].filter((id) => id !== me.id).slice(0, 3);
      for (const id of ids) if (!(await this.store.get<Person>("People", id))) throw new HttpError(400, "一緒に取り組んだ人の指定が正しくありません");
      if (ids.length) coAuthorIds = ids;
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
      ...(effect ? { effect } : {}),
      ...(coAuthorIds ? { coAuthorIds } : {}),
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
        showOnSeatMap: true, showPrivate: true, profileCompleted: true,
      };
      await this.store.put("People", demo.id, demo.branchId, demo);
    }
    await this.seedDemoVoices();
    await this.seedDemoReports();
    await this.seedDemoExtras(demoUserId);
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

  /** デモ表示用：業務改善報告（すでに改善した事例）。拠点をまたいで一緒に取り組んだ例も入れる。すでに入っていれば何もしない */
  private async seedDemoReports() {
    if (await this.store.get<Post>("Posts", "demo-r01")) return;
    // [id, 投稿者, 支店, 分野, 内容, 効果, 拍手, 何日前, 一緒に取り組んだ人]
    type R = [string, string, string, string, string, string, number, number, string[]?];
    const rows: R[] = [
      ["r01", "v01", "a", "お客様対応", "納車時の説明を、1枚のチェックシートにまとめた。", "説明漏れの指摘がなくなった", 14, 2, ["v04"]],
      ["r02", "v02", "a", "品質・整備", "点検結果を、写真つきでタブレットで見せるようにした。", "お客様の納得が早くなった", 11, 5],
      ["r03", "v03", "b", "業務の効率化", "リース契約書の置き場を1か所にまとめた。", "探す時間が1件5分減った", 9, 3, ["v06"]],
      ["r04", "v04", "b", "品質・整備", "EV診断の手順を動画にして共有した。", "新人でも同じ品質で対応できた", 17, 8, ["v01"]],
      ["r05", "v05", "c", "設備・環境", "板金ブースに送風機を追加した。", "夏場の作業の負担が減った", 8, 12],
      ["r06", "v06", "c", "お客様対応", "査定額の説明用シートを作った。", "商談の成約が増えた", 13, 6, ["v09"]],
      ["r07", "v07", "d", "業務の効率化", "代車の空きを、共有カレンダーで見られるようにした。", "電話での確認がいらなくなった", 21, 4, ["v08", "v04"]],
      ["r08", "v08", "d", "安全", "ピットの通路に、足元のラインを引いた。", "つまずきそうになる場面が減った", 10, 15],
      ["r09", "v09", "e", "お客様対応", "初めてのお客様向けの案内を作り直した。", "同じ質問が半分になった", 12, 7],
      ["r10", "v10", "e", "品質・整備", "整備の待ち時間に見られる作業動画を用意した。", "待ち時間の不満が減った", 15, 9, ["v02"]],
      ["r11", "u12", "hq", "業務の効率化", "経費精算のよくある質問を、社内ポータルにまとめた。", "問い合わせが月10件減った", 9, 10, ["v07"]],
      ["r12", "u02", "hq", "安全", "工具の置き場所を色分けした。", "工具を探す手間が減った", 7, 13],
      ["r13", "u11", "hq", "お客様対応", "免許返納の相談用の資料を1枚にまとめた。", "相談の時間が短くなった", 11, 1],
      ["r14", "u03", "hq", "設備・環境", "2Fの複合機の用紙補充の当番を決めた。", "用紙切れがなくなった", 5, 18],
    ];
    const now = Date.now();
    for (const [id, authorId, branchId, category, body, effect, reactions, daysAgo, coAuthorIds] of rows) {
      const author = await this.store.get<Person>("People", authorId);
      const post: Post = {
        id: `demo-${id}`, kind: "report", authorId, authorDept: author?.dept ?? null, branchId, category, body, effect, reactions,
        createdAt: new Date(now - daysAgo * 86400_000).toISOString(), ...(coAuthorIds ? { coAuthorIds } : {}),
      };
      await this.store.put("Posts", post.id, "report", post);
    }
  }
  /** デモ表示用：ギャラリーの写真つき投稿、共有タスク、チャットの例。すでに入っていれば何もしない */
  private async seedDemoExtras(demoUserId: string) {
    if (await this.store.get<Post>("Posts", "demo-g01")) return;
    const now = Date.now();
    const photos: [string, string, string, string, string, number][] = [
      ["g01", "u05", "hq", "/gallery/room.jpg", "朝礼のあと、休憩スペースの飾りつけをしました。", 1],
      ["g02", "v01", "a", "/gallery/sakura.jpg", "店の前の桜が満開です。お客様も足を止めてくれます。", 2],
      ["g03", "v03", "b", "/gallery/shelf.jpg", "展示コーナーの模様替え。ミニカーも並べました。", 3],
      ["g04", "u12", "hq", "/gallery/poster.jpg", "交通安全ポスターを貼りました。止まろう、横断歩道！", 4],
    ];
    const depts = new Map([...SEED_PEOPLE].map((p) => [p.id, p.dept]));
    for (const [id, authorId, branchId, photoUrl, body, daysAgo] of photos) {
      const post: Post = {
        id: `demo-${id}`, kind: "hitokoto", authorId, authorDept: depts.get(authorId) ?? "sales", branchId, category: "できごと",
        body, photoUrl, createdAt: new Date(now - daysAgo * 86400_000).toISOString(), reactions: 5 + daysAgo,
      };
      await this.store.put("Posts", post.id, "hitokoto", post);
    }
    const tasks: SharedTask[] = [
      { id: "demo-t1", title: "安全運転講習の受講報告を提出してください", body: "受講した日と講習名を、業務部のフォームから送ってください。", dueDate: todayJst(11), createdBy: "u05", createdAt: new Date(now - 2 * 86400_000).toISOString(), doneBy: ["u01", "u02", "u04", "u07"] },
      { id: "demo-t2", title: "来月の有給休暇の予定を入力しましょう", dueDate: todayJst(5), createdBy: "u05", createdAt: new Date(now - 1 * 86400_000).toISOString(), doneBy: ["u03", "u10"] },
      { id: "demo-t3", title: "避難訓練を実施します（詳細は各店の掲示をご確認ください）", createdBy: "u05", createdAt: new Date(now - 6 * 86400_000).toISOString(), doneBy: ["u01", "u02", "u03", "u04", "u06", "u07", "u08", "u09", "u10", "u11"] },
    ];
    for (const t of tasks) await this.store.put("Tasks", t.id, "all", t);
    if (await this.store.get<Person>("People", "u02")) {
      const threadId = threadIdOf("u02", demoUserId);
      const m: ChatMessage = { id: "demo-c01", threadId, fromId: "u02", toId: demoUserId, body: "こんにちは！サービス部のみさきです。点検の説明資料、あとで送りますね。", createdAt: new Date(now - 3600_000).toISOString() };
      await this.store.put("Messages", m.id, threadId, m);
    }
  }

  /** デモ表示用：各支店の社員と、直近1か月の投稿（声マップに拠点ごとの色・つながりが出る量）を入れる */
  private async seedDemoVoices() {
    if (await this.store.get<Post>("Posts", "demo-h01")) return;
    const P = (id: string, fullName: string, nickname: string, dept: Person["dept"], unit: string, branchId: string, skills: string[]): Person => ({
      id, fullName, email: `${id}@example.co.jp`, nickname, dept, unit, branchId, skills, talkOk: true,
      showOnSeatMap: true, showPrivate: false, profileCompleted: true,
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
      ["k01", "kaizen", "v07", "d", "業務の効率化", "営業が代車の空きを電話で確認している。サービスと同じ画面で見られると助かる。", 22, 12, "inProgress", "サービス部", ["v04"]],
      ["k02", "kaizen", "v02", "a", "お客様対応", "点検の説明を、営業とエンジニアが一緒にお客様へ伝える場を作りたい。", 16, 15, "reviewing", "サービス部", ["v06"]],
      ["k03", "kaizen", "v09", "e", "お客様対応", "納車前の最終確認を、営業とサービスで同じチェック表にしたい。", 12, 6, "received", "サービス部", ["v10"]],
      ["k04", "kaizen", "v05", "c", "設備・環境", "板金ブースの換気が足りず、夏場に作業しづらい。", 9, 20, "done", "総務"],
      ["k05", "kaizen", "v03", "b", "業務の効率化", "リース契約の書類を、店舗ごとに別々に管理している。共通の置き場が欲しい。", 14, 11, "inProgress", "営業企画"],
      ["k06", "kaizen", "v01", "a", "安全", "店の駐車場の出入口が見えにくく、ひやりとした。ミラーをつけたい。", 18, 4, "received", "安全衛生委員会"],
      ["k07", "kaizen", "v08", "d", "設備・環境", "工具の置き場が足りない。共用の棚を増やしたい。", 7, 25, "done", "総務"],
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
    for (const p of SEED_POSTS) await this.store.put("Posts", p.id, p.kind, p);
    for (const r of DEFAULT_ROUTING_RULES) await this.store.put("RoutingRules", r.department, "all", r);
  }
}
