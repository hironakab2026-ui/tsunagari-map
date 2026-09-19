import type { Dept, Post } from "./types.js";

export type PostTone = "done" | "progress" | "shared" | "unshared";

/** 投稿の状態。改善の声は対応の進み具合、ひとこと投稿は社内ニュースで共有したかどうか */
export function postStatus(p: Post): { label: string; tone: PostTone } {
  if (p.kind === "kaizen") {
    if (p.status === "done") return { label: "解決済み", tone: "done" };
    if (p.status === "inProgress") return { label: "対応中", tone: "progress" };
    if (p.status === "reviewing") return { label: "検討中", tone: "progress" };
    return { label: "受付済み（未対応）", tone: "progress" };
  }
  if (p.kind === "official") return { label: "共有済み（公式）", tone: "shared" };
  return p.pickedForNews ? { label: "共有済み（社内ニュース）", tone: "shared" } : { label: "まだ共有していない", tone: "unshared" };
}

export type PostStatusFilter = "all" | PostTone;
export type PostPeriod = "all" | "week" | "month";
export type PostSort = "new" | "reactions";

export interface PostFilter {
  q: string;
  category: string | null;
  branchId: string | null;
  status: PostStatusFilter;
  period: PostPeriod;
  mine: boolean;
  dept: Dept | null;
  sort: PostSort;
}

export const EMPTY_POST_FILTER: PostFilter = {
  q: "", category: null, branchId: null, status: "all", period: "all", mine: false, dept: null, sort: "new",
};

/** 検索欄以外で、初期値から変えている条件の数（「絞り込み」ボタンのバッジ用） */
export function activeFilterCount(f: PostFilter): number {
  return [f.category, f.branchId, f.status !== "all", f.period !== "all", f.mine, f.dept, f.sort !== "new"].filter(Boolean).length;
}

const PERIOD_DAYS: Record<Exclude<PostPeriod, "all">, number> = { week: 7, month: 30 };

/** 全角・半角や大文字小文字の違いを吸収して比べる（例：ＥＶ と ev を同じに扱う） */
const norm = (s: string) => s.normalize("NFKC").toLowerCase();

export interface FilterContext {
  meId: string;
  authorName: (authorId: string | null) => string;
  branchName?: (branchId: string) => string;
  now?: number;
}

export function filterPosts(posts: Post[], f: PostFilter, ctx: FilterContext): Post[] {
  const now = ctx.now ?? Date.now();
  const terms = norm(f.q).split(/\s+/).filter(Boolean);
  const since = f.period === "all" ? null : now - PERIOD_DAYS[f.period] * 86400_000;

  const out = posts.filter((p) => {
    if (f.category && p.category !== f.category) return false;
    if (f.branchId && p.branchId !== f.branchId) return false;
    if (f.status !== "all" && postStatus(p).tone !== f.status) return false;
    if (since !== null && new Date(p.createdAt).getTime() < since) return false;
    if (f.mine && p.authorId !== ctx.meId) return false;
    if (f.dept && p.authorDept !== f.dept) return false;
    if (terms.length) {
      const hay = norm([p.body, p.category, ctx.authorName(p.authorId), ctx.branchName?.(p.branchId) ?? "", postStatus(p).label].join(" "));
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  return out.sort((a, b) =>
    f.sort === "reactions" && b.reactions !== a.reactions ? b.reactions - a.reactions : b.createdAt.localeCompare(a.createdAt),
  );
}
