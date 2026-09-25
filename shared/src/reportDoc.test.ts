import { describe, expect, it } from "vitest";
import {
  buildReportDocx, composeReportBody, composeReportEffect, reportFileName, reportNumber, toReportDocument, validateReportDetail,
} from "./reportDoc.js";
import { crc32 } from "./zip.js";
import type { Post, ReportDetail } from "./types.js";

/** zip（圧縮なし）を読み戻して、中身を取り出す */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const offset = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // ローカルヘッダー
    expect(v.getUint32(offset, true)).toBe(0x04034b50);
    const lNameLen = v.getUint16(offset + 26, true);
    const data = bytes.subarray(offset + 30 + lNameLen, offset + 30 + lNameLen + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    p += 46 + nameLen;
  }
  return out;
}

/** 開きタグと閉じタグが対応しているか（XMLとして壊れていないかの簡易確認） */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g)) {
    if (m[4] === "/") continue;
    if (m[1] === "/") { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}

const detail: ReportDetail = {
  title: "代車の空き状況を共有カレンダーで確認できるようにした件",
  target: "サービス部・営業（D店）",
  periodStart: "2026-08-01", periodEnd: "2026-08-31",
  categories: ["業務改善", "品質改善"],
  background: "営業が代車の空きを、電話で確認していた。\n1日8件ほど発生。",
  cause: "予約状況が紙の台帳にしかなかった。",
  measures: "共有カレンダーに一本化した。",
  implementedOn: "2026-08-05", implementer: "",
  result: "電話での確認がほぼなくなった。",
  followUp: "他店にも展開する。",
};
const post = (over: Partial<Post> = {}): Post => ({
  id: "r1", kind: "report", authorId: "u1", authorDept: "sales", branchId: "d", category: "業務の効率化",
  body: "本文", createdAt: "2026-09-26T03:00:00Z", reactions: 0, report: detail, ...over,
});

describe("validateReportDetail", () => {
  it("必須の項目がそろっていれば通る。前後の空白は除き、区分は決まったものだけ残す", () => {
    const r = validateReportDetail({ ...detail, title: "  件名  ", categories: ["業務改善", "ぜんぜん違う", "業務改善"] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.detail.title).toBe("件名"); expect(r.detail.categories).toEqual(["業務改善"]); }
  });
  it("必須の項目が空なら、どれが足りないか伝える", () => {
    expect(validateReportDetail({ ...detail, title: " " })).toEqual({ ok: false, error: "件名を入力してください" });
    expect(validateReportDetail({ ...detail, background: "" })).toMatchObject({ ok: false, error: expect.stringContaining("背景") });
    expect(validateReportDetail({ ...detail, measures: "" })).toMatchObject({ ok: false, error: expect.stringContaining("改善策") });
    expect(validateReportDetail({ ...detail, result: "" })).toMatchObject({ ok: false, error: expect.stringContaining("効果") });
  });
  it("長すぎる・日付が正しくない・期間が逆なら受け付けない", () => {
    expect(validateReportDetail({ ...detail, title: "あ".repeat(51) })).toMatchObject({ ok: false });
    expect(validateReportDetail({ ...detail, background: "あ".repeat(401) })).toMatchObject({ ok: false });
    expect(validateReportDetail({ ...detail, periodStart: "来月" })).toMatchObject({ ok: false, error: expect.stringContaining("日付") });
    expect(validateReportDetail({ ...detail, periodStart: "2026-09-01", periodEnd: "2026-08-01" })).toMatchObject({ ok: false, error: expect.stringContaining("終了日") });
  });
  it("原因・今後の対応・期間は空でもよい", () => {
    const r = validateReportDetail({ title: "a", background: "b", measures: "c", result: "d" });
    expect(r.ok).toBe(true);
  });
});

describe("composeReport*", () => {
  it("一覧用の本文は200字以内、効果は80字以内", () => {
    expect(composeReportBody({ ...detail, measures: "あ".repeat(500) }).length).toBeLessThanOrEqual(200);
    expect(composeReportEffect({ ...detail, result: "い".repeat(500) }).length).toBeLessThanOrEqual(80);
    expect(composeReportBody(detail)).toContain(detail.title);
  });
});

describe("reportNumber", () => {
  it("その年に出された順に、3桁で採番する", () => {
    const a = post({ id: "a", createdAt: "2026-03-01T00:00:00Z" });
    const b = post({ id: "b", createdAt: "2026-05-01T00:00:00Z" });
    const c = post({ id: "c", createdAt: "2027-01-05T00:00:00Z" });
    const all = [b, c, a];
    expect(reportNumber(a, all)).toBe("改善-2026-001");
    expect(reportNumber(b, all)).toBe("改善-2026-002");
    expect(reportNumber(c, all)).toBe("改善-2027-001");
  });
});

describe("toReportDocument", () => {
  const ctx = { authorName: "中村 蓮", authorUnit: "店舗営業", coAuthorNames: ["小川 誠"], docNumber: "改善-2026-001" };
  it("アプリの入力を、報告書の項目に当てはめる", () => {
    const d = toReportDocument(post(), ctx);
    expect(d).toMatchObject({
      reportDate: "2026年9月26日", docNumber: "改善-2026-001", reporter: "中村 蓮", creator: "中村 蓮",
      subject: detail.title, target: "サービス部・営業（D店）", period: "2026/8/1〜2026/8/31", implementedOn: "2026/8/5",
      implementer: "中村 蓮、小川 誠", // 実施担当が空なら、本人と一緒に取り組んだ人
    });
    expect(d.categories.filter((c) => c.checked).map((c) => c.label)).toEqual(["業務改善", "品質改善"]);
    expect(d.addressee).toContain("御中");
  });
  it("宛先・確認者・承認者は、指定すれば入り、なければ空欄", () => {
    const d = toReportDocument(post(), { ...ctx, addresseeDept: "品質管理部", addresseeName: "山田 太郎", confirmer: "課長", approver: "" });
    expect(d.addressee).toBe("品質管理部 御中　山田 太郎 様");
    expect(d.confirmer).toBe("課長");
    expect(d.approver).toBe("");
  });
  it("詳細のない古い投稿は、本文と効果から埋める", () => {
    const d = toReportDocument(post({ report: undefined, body: "納車の説明をチェックシートにまとめた。", effect: "指摘がなくなった" }), ctx);
    expect(d.background).toBe("納車の説明をチェックシートにまとめた。");
    expect(d.result).toBe("指摘がなくなった");
    expect(d.subject).toContain("納車の説明");
    expect(d.target).toBe("店舗営業"); // 対象部署が空なら、投稿者の所属
  });
});

describe("buildReportDocx", () => {
  const doc = toReportDocument(post(), { authorName: "中村 蓮", docNumber: "改善-2026-001", addresseeDept: "品質管理部", confirmer: "A & B <課長>" });
  const files = readZip(buildReportDocx(doc));
  const text = (name: string) => new TextDecoder().decode(files.get(name));

  it("Word に必要なファイルがそろい、どれも壊れていない", () => {
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "docProps/core.xml"]);
    for (const [name, data] of files) expect(balanced(new TextDecoder().decode(data)), name).toBe(true);
  });
  it("報告書の各項目が、本文に入っている", () => {
    const x = text("word/document.xml");
    for (const s of ["改 善 報 告 書", "改善-2026-001", "2026年9月26日", "品質管理部 御中", detail.title, "1. 背景・現状（問題点）", "2. 原因分析", "3. 改善策", "4. 実施結果・効果", "5. 考察・再発防止・今後の対応", "確認・承認", "中村 蓮", "2026/8/1〜2026/8/31", "電話での確認がほぼなくなった。"]) {
      expect(x, s).toContain(s);
    }
    expect(x).toContain("☑ 業務改善");
    expect(x).toContain("□ クレーム対応");
    expect(x).toContain("<w:br/>"); // 本文の改行
  });
  it("記号は正しく逃がす", () => {
    expect(text("word/document.xml")).toContain("A &amp; B &lt;課長&gt;");
  });
  it("A4縦の設定がある", () => {
    expect(text("word/document.xml")).toContain('w:pgSz w:w="11906" w:h="16838"');
  });
  it("ファイル名に使えない文字は除く", () => {
    expect(reportFileName({ ...doc, subject: 'a/b:c*"?' })).toBe("改善報告書_改善-2026-001_abc.docx");
  });
});