import { fieldOf } from "./fields.js";
import type { Branch, Person, Post } from "./types.js";

export interface BranchStat {
  branchId: string;
  /** 要改善事項の件数 */
  issue: number;
  /** 業務改善報告の件数 */
  report: number;
  /** 分野（ImprovementField.id）ごとの件数。種類別に持つ */
  fields: { issue: Record<string, number>; report: Record<string, number> };
  latest: string[];
}

/**
 * 声マップ用の集計（要件定義書 F-16）。
 * 声 ＝ 要改善事項（kaizen）と業務改善報告（report）。ひとこと・公式は含めない。
 * つながり ＝ 一緒に取り組んだ人の所属拠点が複数にまたがる声があれば、その拠点どうしを結ぶ。
 */
export function aggregateVoiceMap(branches: Branch[], posts: Post[], people: Person[]) {
  const voices = posts.filter((p) => p.kind === "kaizen" || p.kind === "report");
  const branchOf = new Map(people.map((p) => [p.id, p.branchId]));

  const stats: BranchStat[] = branches.map((b) => {
    const mine = voices.filter((p) => p.branchId === b.id);
    const fields = { issue: {} as Record<string, number>, report: {} as Record<string, number> };
    for (const p of mine) {
      const bucket = p.kind === "kaizen" ? fields.issue : fields.report;
      const id = fieldOf(p.category).id;
      bucket[id] = (bucket[id] ?? 0) + 1;
    }
    return {
      branchId: b.id,
      issue: mine.filter((p) => p.kind === "kaizen").length,
      report: mine.filter((p) => p.kind === "report").length,
      fields,
      latest: mine.slice(0, 3).map((p) => p.body.slice(0, 30)),
    };
  });

  const known = new Set(branches.map((b) => b.id));
  const pairs = new Map<string, [string, string]>();
  for (const post of voices) {
    const ids = [post.authorId, ...(post.coAuthorIds ?? [])].filter((x): x is string => !!x);
    const bs = [...new Set([post.branchId, ...ids.map((id) => branchOf.get(id) ?? post.branchId)])].filter((b) => known.has(b)).sort();
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) pairs.set(`${bs[i]}|${bs[j]}`, [bs[i], bs[j]]);
  }
  return { branches, stats, collaborations: [...pairs.values()] };
}