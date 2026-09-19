import type { Branch, ChatMessage, ChatThread, KaizenStatus, Person, Post, PostKind, Seat, SeatConfig, SharedTask } from "@tsunagari/shared";
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

/** 共有タスク（一覧表示用）。完了した人の一覧は返さず、人数と自分の完了だけ返す */
export type TaskView = Omit<SharedTask, "doneBy"> & { done: boolean; doneCount: number; total: number };

export interface GalleryItem {
  id: string;
  url: string;
  caption: string;
  authorId: string | null;
  createdAt: string;
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
  draw(branchId?: string): Promise<{ seat: Seat }>;
  getSeatConfig(branchId: string): Promise<SeatConfig>;
  updateSeatConfig(branchId: string, config: SeatConfig): Promise<Seat[]>;
  seatAdmins(branchId: string): Promise<Person[]>;
  addSeatAdmin(branchId: string, personId: string): Promise<void>;
  removeSeatAdmin(branchId: string, personId: string): Promise<void>;
  posts(kind: PostKind): Promise<Post[]>;
  createPost(p: NewPost): Promise<Post>;
  react(postId: string): Promise<void>;
  pickForNews(postId: string): Promise<void>;
  voiceMap(): Promise<VoiceMapView>;
  updateKaizenStatus(postId: string, status: KaizenStatus): Promise<void>;
  /** アプリを開いている間、定期的に呼んでオンライン表示を保つ */
  heartbeat(): Promise<void>;
  gallery(): Promise<GalleryItem[]>;
  tasks(): Promise<TaskView[]>;
  createTask(t: { title: string; body?: string; dueDate?: string }): Promise<void>;
  setTaskDone(taskId: string, done: boolean): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  chatThreads(): Promise<ChatThread[]>;
  chatMessages(personId: string): Promise<ChatMessage[]>;
  sendChat(personId: string, body: string): Promise<ChatMessage>;
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
  draw = (branchId?: string) => this.call<{ seat: Seat }>("/seats/draw", { method: "POST", body: JSON.stringify({ branchId }) });
  getSeatConfig = (branchId: string) => this.call<SeatConfig>(`/branches/${branchId}/seat-config`);
  updateSeatConfig = (branchId: string, config: SeatConfig) =>
    this.call<Seat[]>(`/branches/${branchId}/seat-config`, { method: "PUT", body: JSON.stringify(config) });
  seatAdmins = (branchId: string) => this.call<Person[]>(`/branches/${branchId}/seat-admins`);
  addSeatAdmin = (branchId: string, personId: string) =>
    this.call<void>(`/branches/${branchId}/seat-admins`, { method: "POST", body: JSON.stringify({ personId }) });
  removeSeatAdmin = (branchId: string, personId: string) =>
    this.call<void>(`/branches/${branchId}/seat-admins/${personId}`, { method: "DELETE" });
  posts = (kind: PostKind) => this.call<Post[]>(`/posts?kind=${kind}`);
  createPost = (p: NewPost) => this.call<Post>("/posts", { method: "POST", body: JSON.stringify(p) });
  react = (postId: string) => this.call<void>(`/posts/${postId}/reactions`, { method: "POST" });
  pickForNews = (postId: string) => this.call<void>(`/posts/${postId}/pick`, { method: "POST" });
  voiceMap = () => this.call<VoiceMapView>("/voice-map");
  updateKaizenStatus = (postId: string, status: KaizenStatus) =>
    this.call<void>(`/posts/${postId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  heartbeat = () => this.call<void>("/presence", { method: "POST" });
  gallery = () => this.call<GalleryItem[]>("/gallery");
  tasks = () => this.call<TaskView[]>("/tasks");
  createTask = (t: { title: string; body?: string; dueDate?: string }) => this.call<void>("/tasks", { method: "POST", body: JSON.stringify(t) });
  setTaskDone = (taskId: string, done: boolean) => this.call<void>(`/tasks/${taskId}/done`, { method: "POST", body: JSON.stringify({ done }) });
  deleteTask = (taskId: string) => this.call<void>(`/tasks/${taskId}`, { method: "DELETE" });
  chatThreads = () => this.call<ChatThread[]>("/chats");
  chatMessages = (personId: string) => this.call<ChatMessage[]>(`/chats/${personId}`);
  sendChat = (personId: string, body: string) => this.call<ChatMessage>(`/chats/${personId}`, { method: "POST", body: JSON.stringify({ body }) });
}

export const api: Api =
  import.meta.env.VITE_USE_MOCK === "false" ? new HttpApi(import.meta.env.VITE_API_BASE ?? "/api") : new MockApi();
