/** 改善の声の自動振り分け（要件定義書 F-14）。ルールは管理画面・SharePointリストで変更可能にする */
export interface RoutingRule {
  department: string;
  keywords: string[];
  categories?: string[];
  priority: number; // 小さいほど優先
}

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  { department: "安全衛生委員会", keywords: ["安全", "事故", "けが", "ヒヤリ", "転倒"], categories: ["安全"], priority: 1 },
  { department: "サービス部", keywords: ["代車", "点検", "整備", "車検", "部品", "ピット", "工具"], priority: 2 },
  { department: "営業企画", keywords: ["見積", "商談", "納車", "お客様", "試乗"], categories: ["お客様対応"], priority: 3 },
  { department: "情報システム", keywords: ["システム", "パソコン", "Teams", "アプリ", "ログイン", "Wi-Fi"], priority: 4 },
  { department: "総務", keywords: ["複合機", "備品", "駐車場", "清掃", "空調"], categories: ["設備", "設備・環境"], priority: 5 },
];

export const FALLBACK_DEPARTMENT = "総務";

export function routeKaizen(body: string, category: string, rules: RoutingRule[] = DEFAULT_ROUTING_RULES) {
  const scored = rules
    .map((r) => {
      const hits = r.keywords.filter((k) => body.includes(k));
      const catHit = r.categories?.includes(category) ? 1 : 0;
      return { rule: r, points: hits.length * 2 + catHit, hits };
    })
    .filter((x) => x.points > 0)
    .sort((a, b) => b.points - a.points || a.rule.priority - b.rule.priority);
  const top = scored[0];
  return {
    department: top?.rule.department ?? FALLBACK_DEPARTMENT,
    matched: top?.hits ?? [],
    isFallback: !top,
  };
}
