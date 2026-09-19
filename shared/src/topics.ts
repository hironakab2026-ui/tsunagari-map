import { createRng } from "./rng.js";
import type { Post, SharedTask } from "./types.js";

export interface Topic {
  kind: "announce" | "official" | "branch";
  label: string;
  text: string;
  sub?: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * ホームの「トピックス」。アナウンス（共有タスク）の最新1件、公式のお知らせの最新1件、
 * 所属支店のひとこと（ランダム1件）だけを出す。ランダムは seed で固定し、画面を開き直しても急に変わらないようにする。
 */
export function pickTopics(input: { tasks: Pick<SharedTask, "title" | "createdAt" | "dueDate">[]; official: Post[]; hitokoto: Post[]; branchId: string; seed: number }): Topic[] {
  const topics: Topic[] = [];
  const task = [...input.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (task) topics.push({ kind: "announce", label: "アナウンス", text: clip(task.title, 40), sub: task.dueDate ? `期限 ${task.dueDate.replace(/-/g, "/")}` : "全体へのお知らせ" });
  const official = [...input.official].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (official) topics.push({ kind: "official", label: "公式", text: clip(official.body, 40), sub: "本部からのお知らせ" });
  const mine = input.hitokoto.filter((p) => p.branchId === input.branchId);
  if (mine.length > 0) {
    const pick = mine[Math.floor(createRng(input.seed)() * mine.length)];
    topics.push({ kind: "branch", label: "支店ニュース", text: clip(pick.body, 40), sub: "所属支店のひとこと" });
  }
  return topics;
}