/** 投稿前の個人情報チェック（要件定義書 11章）。検知したら送信前に確認を促す。完全な検知は保証しない */
const PATTERNS: { label: string; re: RegExp }[] = [
  { label: "電話番号", re: /0\d{1,4}[-(（]?\d{1,4}[-)）]?\d{3,4}/ },
  { label: "メールアドレス", re: /[\w.+-]+@[\w-]+\.[\w.]+/ },
  { label: "車両番号", re: /[一-龥]{1,4}\s*\d{3}\s*[ぁ-ん]\s*\d{1,2}-?\d{2}/ },
  { label: "お客様の氏名の可能性", re: /[一-龥]{1,3}\s?[一-龥]{1,3}(様|さま)/ },
];

export function detectPii(text: string): string[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
}
