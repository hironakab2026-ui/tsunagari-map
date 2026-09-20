import {
  SEED_BRANCHES, SEED_PEOPLE, SEED_POSTS,
  IMPROVEMENT_FIELDS, aggregateVoiceMap, buildSeatsFromConfig, drawSeat, routeKaizen,
  type Branch, type KaizenStatus, type Person, type Post, type PostKind, type Seat, type SeatConfig,
} from "@tsunagari/shared";
import { threadIdOf, type ChatMessage, type ChatThread, type SharedTask } from "@tsunagari/shared";
import type { Api, FloorView, GalleryItem, NewPost, TaskView } from "./api";

// URL に ?mockUser=u13 を付けると、その人としてログインした状態を試せる（初回ログイン導線や権限の確認用）
const ME = new URLSearchParams(location.search).get("mockUser") ?? "u05";
const ADMIN_ROLES = ["SeatManager", "PR", "KaizenOwner"];
const EDITABLE_PROFILE: (keyof Person)[] = ["fullName", "nickname", "skills", "hobby", "askMe", "talkOk", "showOnSeatMap", "showPrivate", "avatarUrl"];

const mockDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400_000).toISOString().slice(0, 10);
/** モックでは、この人たちは常にオンライン（着席中の人と自分もオンライン） */
const MOCK_ONLINE = new Set(["u02", "u07", "u11"]);
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => structuredClone(v);

/** Microsoft 365 なしで画面を確認するためのモック。ブラウザを再読み込みすると初期状態に戻る */
export class MockApi implements Api {
  private peopleData = clone(SEED_PEOPLE);
  private postsData = clone(SEED_POSTS);
  private branchesData: Branch[] = clone(SEED_BRANCHES);
  private seatsByBranch = new Map<string, Seat[]>(
    this.branchesData.map((b) => [b.id, buildSeatsFromConfig(b.id, b.id === "hq" ? "2F" : "1F", b.seatConfig)]),
  );
  private occupancy: Record<string, string[]> = {};
  private tasksData: SharedTask[] = [
    { id: "t1", title: "安全運転講習の受講報告を提出してください", body: "受講した日と講習名を、業務部のフォームから送ってください。", dueDate: mockDate(11), createdBy: "u05", createdAt: new Date(Date.now() - 2 * 86400_000).toISOString(), doneBy: ["u01", "u02", "u04", "u07"] },
    { id: "t2", title: "来月の有給休暇の予定を入力しましょう", dueDate: mockDate(5), createdBy: "u05", createdAt: new Date(Date.now() - 86400_000).toISOString(), doneBy: ["u03", "u10"] },
    { id: "t3", title: "避難訓練を実施します（詳細は各店の掲示をご確認ください）", createdBy: "u05", createdAt: new Date(Date.now() - 6 * 86400_000).toISOString(), doneBy: ["u01", "u02", "u03", "u04", "u06", "u07", "u08", "u09", "u10", "u11"] },
  ];
  private messagesData: ChatMessage[] = [
    { id: "c1", threadId: threadIdOf("u02", ME), fromId: "u02", toId: ME, body: "こんにちは！サービス部のみさきです。点検の説明資料、あとで送りますね。", createdAt: new Date(Date.now() - 3600_000).toISOString() },
  ];

  constructor() {
    // デモ用：本社のグループ席の1つに2人ほど着席させておく
    const hqSeats = this.seatsByBranch.get("hq")!;
    const group = hqSeats.find((s) => s.kind === "group")!;
    this.occupancy[group.id] = ["u07", "u10"];
    const priv = hqSeats.find((s) => s.kind === "private")!;
    this.occupancy[priv.id] = ["u02"];
  }

  private currentPerson() { return this.peopleData.find((p) => p.id === ME)!; }
  private roles() { return ME === "u05" ? ADMIN_ROLES : []; }
  private isSeatAdmin(branchId: string) {
    const roles = this.roles();
    if (roles.includes("Admin") || roles.includes("SeatManager")) return true;
    return !!this.branchesData.find((b) => b.id === branchId)?.seatAdminIds.includes(ME);
  }

  async me() {
    await wait();
    const me = this.currentPerson();
    return { ...clone(me), roles: this.roles(), isSeatAdmin: this.isSeatAdmin(me.branchId) };
  }
  async updateMe(patch: Partial<Person>) {
    await wait();
    const i = this.peopleData.findIndex((p) => p.id === ME);
    const next = { ...this.peopleData[i] };
    for (const k of EDITABLE_PROFILE) if (k in patch) (next as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
    next.fullName = (next.fullName ?? "").trim();
    if (!next.fullName) throw new Error("氏名を入力してください");
    next.nickname = (next.nickname ?? "").trim();
    next.skills = (next.skills ?? []).slice(0, 5).map((s) => s.slice(0, 20));
    if (!next.avatarUrl) delete next.avatarUrl;
    next.profileCompleted = true;
    this.peopleData[i] = next;
    return { ...clone(next), roles: this.roles() };
  }
  async people() {
    await wait();
    const seated = new Set(Object.values(this.occupancy).flat());
    return clone(this.peopleData.map((p) => ({ ...p, online: p.id === ME || seated.has(p.id) || MOCK_ONLINE.has(p.id) })));
  }
  async branches() { await wait(); return clone(this.branchesData); }

  async floor(branchId?: string): Promise<FloorView> {
    await wait();
    const bid = branchId ?? this.currentPerson().branchId;
    const branch = this.branchesData.find((b) => b.id === bid)!;
    const seats = this.seatsByBranch.get(bid)!;
    const hidden = new Set(this.peopleData.filter((p) => !p.showOnSeatMap && p.id !== ME).map((p) => p.id));
    const assignments: Record<string, string[]> = {};
    for (const s of seats) assignments[s.id] = (this.occupancy[s.id] ?? []).filter((id) => !hidden.has(id));
    return clone({ branch, seats, assignments });
  }

  private removeFromCurrentSeat() {
    for (const [seatId, ids] of Object.entries(this.occupancy)) {
      if (ids.includes(ME)) this.occupancy[seatId] = ids.filter((id) => id !== ME);
    }
  }

  async checkIn(seatCode: string) {
    await wait();
    const me = this.currentPerson();
    const code = seatCode.trim().toUpperCase();
    const seats = this.seatsByBranch.get(me.branchId)!;
    const seat = seats.find((s) => s.id.toUpperCase() === code || s.label.toUpperCase() === code);
    if (!seat) throw new Error(`席「${seatCode}」が見つかりません。机のQRコードの下にある席番号を確認してください`);
    const occupants = this.occupancy[seat.id] ?? [];
    if (occupants.length >= seat.capacity && !occupants.includes(ME)) throw new Error("この席は満席です");
    this.removeFromCurrentSeat();
    this.occupancy[seat.id] = [...(this.occupancy[seat.id] ?? []), ME];
    return { seat };
  }
  async checkOut() { await wait(); this.removeFromCurrentSeat(); }

  async draw(branchId?: string) {
    await wait(300);
    const me = { ...this.currentPerson(), branchId: branchId || this.currentPerson().branchId };
    const seats = this.seatsByBranch.get(me.branchId)!;
    const others: Record<string, string[]> = {};
    for (const [id, ids] of Object.entries(this.occupancy)) others[id] = ids.filter((x) => x !== ME);
    const result = drawSeat({ seats, occupancy: others, personId: ME });
    if (!result) throw new Error("現在、空いている席がありません。しばらくしてから再度お試しください");
    this.removeFromCurrentSeat();
    const seat = seats.find((s) => s.id === result.seatId)!;
    this.occupancy[seat.id] = [...(this.occupancy[seat.id] ?? []), ME];
    return { seat };
  }

  async getSeatConfig(branchId: string) {
    await wait();
    return clone(this.branchesData.find((b) => b.id === branchId)!.seatConfig);
  }
  async updateSeatConfig(branchId: string, config: SeatConfig) {
    await wait();
    if (!this.isSeatAdmin(branchId)) throw new Error("この拠点の座席を編集する権限がありません");
    const branch = this.branchesData.find((b) => b.id === branchId)!;
    branch.seatConfig = config;
    const seats = buildSeatsFromConfig(branchId, branchId === "hq" ? "2F" : "1F", config);
    for (const old of this.seatsByBranch.get(branchId) ?? []) delete this.occupancy[old.id];
    this.seatsByBranch.set(branchId, seats);
    return clone(seats);
  }
  async seatAdmins(branchId: string) {
    await wait();
    const branch = this.branchesData.find((b) => b.id === branchId)!;
    return clone(this.peopleData.filter((p) => branch.seatAdminIds.includes(p.id)));
  }
  async addSeatAdmin(branchId: string, personId: string) {
    await wait();
    const branch = this.branchesData.find((b) => b.id === branchId)!;
    if (!branch.seatAdminIds.includes(personId)) branch.seatAdminIds.push(personId);
  }
  async removeSeatAdmin(branchId: string, personId: string) {
    await wait();
    const branch = this.branchesData.find((b) => b.id === branchId)!;
    branch.seatAdminIds = branch.seatAdminIds.filter((id) => id !== personId);
  }


  async posts(kind: PostKind) { await wait(); return clone(this.postsData.filter((p) => p.kind === kind)); }
  async createPost(input: NewPost) {
    await wait();
    if (input.kind === "official" && !this.roles().includes("PR")) throw new Error("この操作を行う権限がありません");
    const me = this.currentPerson();
    const anonymous = input.kind === "kaizen" && !!input.anonymous;
    const isVoice = input.kind === "kaizen" || input.kind === "report";
    const branchId = isVoice && input.branchId ? input.branchId : me.branchId;
    const post: Post = {
      id: `p${Date.now()}`, kind: input.kind, category: input.category, body: input.body,
      authorId: anonymous ? null : ME, authorDept: anonymous ? null : me.dept, branchId,
      createdAt: new Date().toISOString(), reactions: 0, photoUrl: input.photoDataUrl,
      ...(input.mediaDataUrl
        ? { mediaType: input.mediaDataUrl.startsWith("data:video/") ? ("video" as const) : ("image" as const), mediaUrl: input.mediaDataUrl }
        : input.mediaUrl ? { mediaType: input.mediaType ?? "video", mediaUrl: input.mediaUrl } : {}),
      ...(input.kind === "kaizen" ? { status: "received" as const, assignedTo: routeKaizen(input.body, input.category).department } : {}),
      ...(input.kind === "report" && input.effect?.trim() ? { effect: input.effect.trim() } : {}),
      ...(isVoice && input.coAuthorIds?.length ? { coAuthorIds: input.coAuthorIds.filter((id) => id !== ME).slice(0, 3) } : {}),
    };
    this.postsData.unshift(post);
    return clone(post);
  }
  async react(postId: string) { await wait(50); const p = this.postsData.find((x) => x.id === postId); if (p) p.reactions++; }
  async pickForNews(postId: string) {
    await wait();
    if (!this.roles().includes("PR")) throw new Error("この操作を行う権限がありません");
    const p = this.postsData.find((x) => x.id === postId);
    if (p) p.pickedForNews = true;
  }
  async updateKaizenStatus(postId: string, status: KaizenStatus) {
    await wait(); const p = this.postsData.find((x) => x.id === postId); if (p) p.status = status;
  }
  async voiceMap() {
    await wait();
    // デモでは、拠点ごとに件数を足して、円の大きさと色分けが見やすいようにする [拠点, 要改善事項, 業務改善報告]
    const plan: [string, number, number][] = [["hq", 5, 7], ["a", 3, 5], ["b", 4, 7], ["c", 2, 4], ["d", 3, 3], ["e", 1, 3]];
    const labels = IMPROVEMENT_FIELDS.map((f) => f.label);
    const extra: Post[] = [];
    plan.forEach(([b, issue, report], bi) => {
      for (let i = 0; i < issue; i++) extra.push({ id: `xi${b}${i}`, kind: "kaizen", authorId: null, authorDept: null, branchId: b, category: labels[(i + bi) % labels.length], body: "", createdAt: "", reactions: 0 });
      for (let i = 0; i < report; i++) extra.push({ id: `xr${b}${i}`, kind: "report", authorId: null, authorDept: null, branchId: b, category: labels[(i * 2 + bi) % labels.length], body: "", createdAt: "", reactions: 0 });
    });
    const view = aggregateVoiceMap(this.branchesData, [...this.postsData, ...extra], this.peopleData);
    const latest = new Map(this.postsData.filter((p) => p.kind === "kaizen" || p.kind === "report").map((p) => [p.branchId, p.body.slice(0, 40)]));
    view.stats.forEach((s) => (s.latest = latest.has(s.branchId) ? [latest.get(s.branchId)!] : []));
    for (const pair of [["a", "c"], ["hq", "a"], ["b", "d"]] as [string, string][]) {
      if (!view.collaborations.some(([x, y]) => x === pair[0] && y === pair[1])) view.collaborations.push(pair);
    }
    return clone(view);
  }
  async heartbeat() { /* モックでは何もしない */ }

  async gallery(): Promise<GalleryItem[]> {
    await wait();
    return clone(
      this.postsData
        .flatMap((p) => {
          const url = p.photoUrl ?? (p.mediaType === "image" ? p.mediaUrl : undefined);
          return url && p.kind !== "kaizen" ? [{ id: p.id, url, caption: p.body, authorId: p.authorId, createdAt: p.createdAt }] : [];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20),
    );
  }

  async tasks(): Promise<TaskView[]> {
    await wait();
    const total = this.peopleData.length;
    return clone([...this.tasksData]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ doneBy, ...t }) => ({ ...t, done: doneBy.includes(ME), doneCount: doneBy.length, total })));
  }
  async createTask(input: { title: string; body?: string; dueDate?: string }) {
    await wait();
    if (!this.roles().includes("PR")) throw new Error("この操作を行う権限がありません");
    const title = input.title.trim();
    if (!title) throw new Error("タイトルを入力してください");
    this.tasksData.unshift({
      id: `t${Date.now()}`, title, ...(input.body?.trim() ? { body: input.body.trim() } : {}), ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      createdBy: ME, createdAt: new Date().toISOString(), doneBy: [],
    });
  }
  async setTaskDone(taskId: string, done: boolean) {
    await wait(60);
    const t = this.tasksData.find((x) => x.id === taskId);
    if (!t) throw new Error("タスクが見つかりません");
    t.doneBy = t.doneBy.filter((id) => id !== ME);
    if (done) t.doneBy.push(ME);
  }
  async deleteTask(taskId: string) {
    await wait();
    if (!this.roles().includes("PR")) throw new Error("この操作を行う権限がありません");
    this.tasksData = this.tasksData.filter((t) => t.id !== taskId);
  }

  async chatThreads(): Promise<ChatThread[]> {
    await wait(60);
    const byPeer = new Map<string, ChatThread>();
    for (const m of this.messagesData.filter((x) => x.fromId === ME || x.toId === ME)) {
      const peer = m.fromId === ME ? m.toId : m.fromId;
      const cur = byPeer.get(peer) ?? { personId: peer, last: m, unread: 0 };
      if (m.createdAt > cur.last.createdAt) cur.last = m;
      if (m.toId === ME && !m.readAt) cur.unread++;
      byPeer.set(peer, cur);
    }
    return clone([...byPeer.values()].sort((a, b) => b.last.createdAt.localeCompare(a.last.createdAt)));
  }
  async chatMessages(personId: string) {
    await wait(60);
    const list = this.messagesData.filter((m) => m.threadId === threadIdOf(ME, personId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const m of list) if (m.toId === ME && !m.readAt) m.readAt = new Date().toISOString();
    return clone(list);
  }
  async sendChat(personId: string, body: string) {
    await wait(60);
    const text = body.trim();
    if (!text) throw new Error("メッセージを入力してください");
    if (text.length > 500) throw new Error("500字以内で入力してください");
    const msg: ChatMessage = { id: `m${Date.now()}`, threadId: threadIdOf(ME, personId), fromId: ME, toId: personId, body: text, createdAt: new Date().toISOString() };
    this.messagesData.push(msg);
    // モックでは、相手が少ししてから返信したことにして、やり取りの流れを確かめられるようにする
    setTimeout(() => {
      this.messagesData.push({ id: `m${Date.now()}r`, threadId: msg.threadId, fromId: personId, toId: ME, body: "メッセージありがとうございます。あとで確認して返信しますね。", createdAt: new Date().toISOString() });
    }, 2500);
    return clone(msg);
  }
}