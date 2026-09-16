import type { Branch, Person, Post } from "./types.js";

export interface BranchStat {
  branchId: string;
  sales: number;
  eng: number;
  office: number;
  kaizen: number;
  latest: string[];
}

/** 声マップ用の集計（要件定義書 F-16） */
export function aggregateVoiceMap(branches: Branch[], posts: Post[], people: Person[]) {
  const deptOf = new Map(people.map((p) => [p.id, p.dept]));
  const branchOf = new Map(people.map((p) => [p.id, p.branchId]));
  const stats: BranchStat[] = branches.map((b) => {
    const mine = posts.filter((p) => p.branchId === b.id);
    const count = (d: string) => mine.filter((p) => p.authorDept === d).length;
    return {
      branchId: b.id,
      sales: count("sales"),
      eng: count("eng"),
      office: count("office") + mine.filter((p) => p.authorDept === null).length,
      kaizen: mine.filter((p) => p.kind === "kaizen").length,
      latest: mine.slice(0, 3).map((p) => p.body.slice(0, 30)),
    };
  });

  // 営業とエンジニアが共同で出した改善の声 → 関係者の所属拠点同士を線で結ぶ
  const pairs = new Map<string, [string, string]>();
  for (const post of posts.filter((p) => p.kind === "kaizen")) {
    const ids = [post.authorId, ...(post.coAuthorIds ?? [])].filter((x): x is string => !!x);
    const depts = new Set(ids.map((id) => deptOf.get(id)));
    if (!(depts.has("sales") && depts.has("eng"))) continue;
    const bs = [...new Set([post.branchId, ...ids.map((id) => branchOf.get(id) ?? post.branchId)])].sort();
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) pairs.set(`${bs[i]}|${bs[j]}`, [bs[i], bs[j]]);
    if (bs.length === 1) pairs.set(`${bs[0]}|${bs[0]}`, [bs[0], bs[0]]);
  }
  return { branches, stats, collaborations: [...pairs.values()] };
}
