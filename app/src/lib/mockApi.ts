import {
  SEED_BRANCHES, SEED_PEOPLE, SEED_POSTS,
  aggregateVoiceMap, buildSeatsFromConfig, drawSeat, routeKaizen,
  type Branch, type KaizenStatus, type Person, type Post, type PostKind, type Seat, type SeatConfig,
} from "@tsunagari/shared";
import type { Api, FloorView, NewPost } from "./api";

// URL に ?mockUser=u13 を付けると、その人としてログインした状態を試せる（初回ログイン導線や権限の確認用）
const ME = new URLSearchParams(location.search).get("mockUser") ?? "u05";
const ADMIN_ROLES = ["SeatManager", "PR", "KaizenOwner"];
const EDITABLE_PROFILE: (keyof Person)[] = ["nickname", "skills", "hobby", "askMe", "talkOk", "showOnSeatMap", "showPrivate", "avatarUrl"];

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
    next.skills = (next.skills ?? []).slice(0, 5).map((s) => s.slice(0, 20));
    if (!next.avatarUrl) delete next.avatarUrl;
    next.profileCompleted = true;
    this.peopleData[i] = next;
    return { ...clone(next), roles: this.roles() };
  }
  async people() { await wait(); return clone(this.peopleData); }
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
    const branchId = input.kind === "kaizen" && input.branchId ? input.branchId : me.branchId;
    const post: Post = {
      id: `p${Date.now()}`, kind: input.kind, category: input.category, body: input.body,
      authorId: anonymous ? null : ME, authorDept: anonymous ? null : me.dept, branchId,
      createdAt: new Date().toISOString(), reactions: 0, photoUrl: input.photoDataUrl,
      ...(input.mediaDataUrl
        ? { mediaType: input.mediaDataUrl.startsWith("data:video/") ? ("video" as const) : ("image" as const), mediaUrl: input.mediaDataUrl }
        : input.mediaUrl ? { mediaType: input.mediaType ?? "video", mediaUrl: input.mediaUrl } : {}),
      ...(input.kind === "kaizen" ? { status: "received" as const, assignedTo: routeKaizen(input.body, input.category).department } : {}),
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
    // デモでは拠点ごとの件数を増やして見やすくする
    const extra: Post[] = [];
    const demo: [string, number, number, number, number][] = [["hq", 6, 4, 9, 5], ["a", 3, 5, 1, 3], ["b", 5, 6, 1, 6], ["c", 2, 7, 1, 2], ["d", 3, 2, 0, 4], ["e", 1, 2, 0, 1]];
    for (const [b, s, e, o, k] of demo) {
      const add = (dept: "sales" | "eng" | "office", n: number, kind: PostKind) => {
        for (let i = 0; i < n; i++) extra.push({ id: `x${b}${dept}${kind}${i}`, kind, authorId: null, authorDept: dept, branchId: b, category: "", body: "", createdAt: "", reactions: 0 });
      };
      add("sales", s, "hitokoto"); add("eng", e, "hitokoto"); add("office", o, "hitokoto");
      for (let i = 0; i < k; i++) extra.push({ id: `k${b}${i}`, kind: "kaizen", authorId: null, authorDept: "office", branchId: b, category: "", body: "", createdAt: "", reactions: 0 });
    }
    const people = this.peopleData.map((p) => (p.id === "u10" ? { ...p, branchId: "b" } : p.id === "u08" ? { ...p, branchId: "d" } : p));
    const view = aggregateVoiceMap(this.branchesData, [...this.postsData, ...extra], people);
    const latest = new Map(this.postsData.map((p) => [p.branchId, p.body.slice(0, 40)]));
    view.stats.forEach((s) => (s.latest = latest.has(s.branchId) ? [latest.get(s.branchId)!] : []));
    view.collaborations.push(["a", "c"], ["hq", "a"]);
    return clone(view);
  }
}
