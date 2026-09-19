import type { Branch, KaizenStatus, Person, Post, PostKind, Seat, SeatConfig } from "@tsunagari/shared";
import { getSsoToken } from "./teams";
import { MockApi } from "./mockApi";

export interface FloorView {
  branch: Branch;
  seats: Seat[];
  assignments: Record<string, string[]>; // seatId -> 着席中の personId 配列
}

export interface BranchStat {
  branchId: string;
  sales: number;
  eng: number;
  office: number;
  kaizen: number;
  latest: string[];
}

export interface VoiceMapView {
  branches: Branch[];
  stats: BranchStat[];
  collaborations: [string, string][]; // 営業×エンジニア共同提案のあった拠点ペア
}

export interface NewPost {
  kind: PostKind;
  category: string;
  body: string;
  anonymous?: boolean;
  photoDataUrl?: string;
  branchId?: string;
  mediaType?: "image" | "video";
  mediaUrl?: string;
  /** 公式ニュースにアップロードする動画・画像（data URL） */
  mediaDataUrl?: string;
}

export interface Api {
  me(): Promise<Person & { isSeatAdmin?: boolean }>;
  updateMe(p: Partial<Person>): Promise<Person>;
  people(): Promise<Person[]>;
  branches(): Promise<Branch[]>;
  floor(branchId?: string): Promise<FloorView>;
  checkIn(seatCode: string): Promise<{ seat: Seat }>;
  checkOut(): Promise<void>;
  draw(): Promise<{ seat: Seat }>;
  getSeatConfig(branchId: string): Promise<SeatConfig>;
  updateSeatConfig(branchId: string, config: SeatConfig): Promise<Seat[]>;
  seatAdmins(branchId: string): Promise<Person[]>;
  addSeatAdmin(branchId: string, personId: string): Promise<void>;
  removeSeatAdmin(branchId: string, personId: string): Promise<void>;
  addWish(toId: string): Promise<void>;
  posts(kind: PostKind): Promise<Post[]>;
  createPost(p: NewPost): Promise<Post>;
  react(postId: string): Promise<void>;
  pickForNews(postId: string): Promise<void>;
  voiceMap(): Promise<VoiceMapView>;
  updateKaizenStatus(postId: string, status: KaizenStatus): Promise<void>;
}

class HttpApi implements Api {
  constructor(private base: string) {}
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getSsoToken();
    const res = await fetch(this.base + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `通信に失敗しました（${res.status}）`);
    }
    return res.status === 204 ? (undefined as T) : res.json();
  }
  me = () => this.call<Person>("/me");
  updateMe = (p: Partial<Person>) => this.call<Person>("/me", { method: "PUT", body: JSON.stringify(p) });
  people = () => this.call<Person[]>("/people");
  branches = () => this.call<Branch[]>("/branches");
  floor = (branchId?: string) => this.call<FloorView>(`/floor${branchId ? `?branchId=${branchId}` : ""}`);
  checkIn = (seatCode: string) => this.call<{ seat: Seat }>("/checkin", { method: "POST", body: JSON.stringify({ seatCode }) });
  checkOut = () => this.call<void>("/checkout", { method: "POST" });
  draw = () => this.call<{ seat: Seat }>("/seats/draw", { method: "POST" });
  getSeatConfig = (branchId: string) => this.call<SeatConfig>(`/branches/${branchId}/seat-config`);
  updateSeatConfig = (branchId: string, config: SeatConfig) =>
    this.call<Seat[]>(`/branches/${branchId}/seat-config`, { method: "PUT", body: JSON.stringify(config) });
  seatAdmins = (branchId: string) => this.call<Person[]>(`/branches/${branchId}/seat-admins`);
  addSeatAdmin = (branchId: string, personId: string) =>
    this.call<void>(`/branches/${branchId}/seat-admins`, { method: "POST", body: JSON.stringify({ personId }) });
  removeSeatAdmin = (branchId: string, personId: string) =>
    this.call<void>(`/branches/${branchId}/seat-admins/${personId}`, { method: "DELETE" });
  addWish = (toId: string) => this.call<void>("/wishes", { method: "POST", body: JSON.stringify({ toId }) });
  posts = (kind: PostKind) => this.call<Post[]>(`/posts?kind=${kind}`);
  createPost = (p: NewPost) => this.call<Post>("/posts", { method: "POST", body: JSON.stringify(p) });
  react = (postId: string) => this.call<void>(`/posts/${postId}/reactions`, { method: "POST" });
  pickForNews = (postId: string) => this.call<void>(`/posts/${postId}/pick`, { method: "POST" });
  voiceMap = () => this.call<VoiceMapView>("/voice-map");
  updateKaizenStatus = (postId: string, status: KaizenStatus) =>
    this.call<void>(`/posts/${postId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export const api: Api =
  import.meta.env.VITE_USE_MOCK === "false" ? new HttpApi(import.meta.env.VITE_API_BASE ?? "/api") : new MockApi();
