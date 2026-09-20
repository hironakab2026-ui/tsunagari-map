/** 改善の分野。要改善事項・業務改善報告の「種類」であり、声マップの円グラフの色分けにも使う */
export interface ImprovementField {
  id: string;
  label: string;
  color: string;
}

export const IMPROVEMENT_FIELDS: ImprovementField[] = [
  { id: "customer", label: "お客様対応", color: "#E96A9B" },
  { id: "efficiency", label: "業務の効率化", color: "#5FA83A" },
  { id: "facility", label: "設備・環境", color: "#3E97D1" },
  { id: "safety", label: "安全", color: "#F0954A" },
  { id: "quality", label: "品質・整備", color: "#8656B5" },
  { id: "other", label: "その他", color: "#A89B86" },
];

/** 以前の分類名で保存された投稿も、いまの分野に読み替える */
const ALIASES: Record<string, string> = { 業務の手間: "efficiency", 設備: "facility" };

export function fieldOf(category: string): ImprovementField {
  const byLabel = IMPROVEMENT_FIELDS.find((f) => f.label === category);
  if (byLabel) return byLabel;
  const id = ALIASES[category];
  return IMPROVEMENT_FIELDS.find((f) => f.id === id) ?? IMPROVEMENT_FIELDS[IMPROVEMENT_FIELDS.length - 1];
}