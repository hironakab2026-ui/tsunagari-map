import { zipStore } from "./zip.js";
import { REPORT_CATEGORIES, type Post, type ReportDetail } from "./types.js";

/* ===================== 入力の確認と、一覧に出す本文の作成 ===================== */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type ReportInput = Partial<ReportDetail>;

/** 業務改善報告の詳細を確認して、整えた値を返す。問題があれば、利用者に見せる文言を返す */
export function validateReportDetail(input: ReportInput | undefined): { ok: true; detail: ReportDetail } | { ok: false; error: string } {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const title = s(input?.title);
  const background = s(input?.background);
  const measures = s(input?.measures);
  const result = s(input?.result);
  const cause = s(input?.cause);
  const followUp = s(input?.followUp);
  const target = s(input?.target);
  const implementer = s(input?.implementer);

  if (!title) return { ok: false, error: "件名を入力してください" };
  if (title.length > 50) return { ok: false, error: "件名は50字以内で入力してください" };
  if (target.length > 50) return { ok: false, error: "対象業務・部署は50字以内で入力してください" };
  if (implementer.length > 40) return { ok: false, error: "実施担当は40字以内で入力してください" };
  if (!background) return { ok: false, error: "背景・現状（問題点）を入力してください" };
  if (!measures) return { ok: false, error: "改善策・実施した対策を入力してください" };
  if (!result) return { ok: false, error: "実施結果・効果を入力してください" };
  for (const [label, v] of [["背景・現状", background], ["原因分析", cause], ["改善策", measures], ["実施結果・効果", result], ["今後の対応", followUp]] as const) {
    if (v.length > 400) return { ok: false, error: `${label}は400字以内で入力してください` };
  }

  const periodStart = s(input?.periodStart);
  const periodEnd = s(input?.periodEnd);
  const implementedOn = s(input?.implementedOn);
  for (const [label, v] of [["改善実施期間の開始日", periodStart], ["改善実施期間の終了日", periodEnd], ["実施日", implementedOn]] as const) {
    if (v && !validDate(v)) return { ok: false, error: `${label}の日付が正しくありません` };
  }
  if (periodStart && periodEnd && periodStart > periodEnd) return { ok: false, error: "改善実施期間の終了日は、開始日より後にしてください" };

  const categories = [...new Set((Array.isArray(input?.categories) ? input!.categories : []).filter((c): c is string => (REPORT_CATEGORIES as readonly string[]).includes(c)))];

  return {
    ok: true,
    detail: {
      title, target, categories, background, cause, measures, result, followUp,
      ...(periodStart ? { periodStart } : {}), ...(periodEnd ? { periodEnd } : {}),
      ...(implementedOn ? { implementedOn } : {}), ...(implementer ? { implementer } : {}),
    },
  };
}

/** 一覧・検索に使う本文（200字まで）。件名と、改善策の冒頭 */
export function composeReportBody(d: ReportDetail): string {
  return clip(`${d.title}：${d.measures.replace(/\s+/g, " ")}`, 200);
}

/** 一覧に出す短い効果（80字まで） */
export function composeReportEffect(d: ReportDetail): string {
  return clip(d.result.replace(/\s+/g, " "), 80);
}

/* ===================== 報告書の内容（画面の表示と Word で共通） ===================== */

export interface ReportDocument {
  reportDate: string;    // 2026年9月26日
  docNumber: string;     // 改善-2026-001
  addressee: string;     // 品質管理部 御中　〇〇 〇〇 様
  reporter: string;
  subject: string;
  target: string;
  period: string;
  categories: { label: string; checked: boolean }[];
  background: string;
  cause: string;
  measures: string;
  implementedOn: string;
  implementer: string;
  result: string;
  followUp: string;
  creator: string;
  confirmer: string;
  approver: string;
}

/** 報告書に、その場で足す項目（アプリには保存しない）。空なら、手書きできるよう空欄にする */
export interface ReportExtras {
  addresseeDept?: string;
  addresseeName?: string;
  confirmer?: string;
  approver?: string;
}

export interface ReportContext extends ReportExtras {
  authorName: string;
  authorUnit?: string;
  branchName?: string;
  coAuthorNames?: string[];
  docNumber: string;
}

const jst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000);

const jaDate = (iso: string) => {
  const d = jst(iso);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
};

const slashDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}/${m}/${d}`;
};

/** 文書番号。その年に出された業務改善報告の、出された順（改善-2026-001） */
export function reportNumber(post: Post, reports: Post[]): string {
  const year = jst(post.createdAt).getUTCFullYear();
  const sameYear = reports
    .filter((p) => p.kind === "report" && jst(p.createdAt).getUTCFullYear() === year)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const idx = sameYear.findIndex((p) => p.id === post.id);
  return `改善-${year}-${String((idx < 0 ? sameYear.length + 1 : idx + 1)).padStart(3, "0")}`;
}

/**
 * アプリに書かれた内容を、会社の改善報告書の項目に当てはめる。
 * 詳細（report）がない古い投稿は、本文を「背景・現状」に、効果を「実施結果・効果」に入れる。
 */
export function toReportDocument(post: Post, ctx: ReportContext): ReportDocument {
  const d = post.report;
  const detail: ReportDetail = d ?? {
    title: clip(post.body.replace(/\s+/g, " "), 40), target: "", categories: [],
    background: post.body, cause: "", measures: "", result: post.effect ?? "", followUp: "",
  };
  const period = detail.periodStart
    ? `${slashDate(detail.periodStart)}〜${detail.periodEnd ? slashDate(detail.periodEnd) : ""}`
    : detail.periodEnd ? `〜${slashDate(detail.periodEnd)}` : "";
  const people = [ctx.authorName, ...(ctx.coAuthorNames ?? [])].filter(Boolean);
  const dept = (ctx.addresseeDept ?? "").trim();
  const name = (ctx.addresseeName ?? "").trim();
  return {
    reportDate: jaDate(post.createdAt),
    docNumber: ctx.docNumber,
    addressee: `${dept || "　　　　　　"} 御中　${name || "　　　　　　"} 様`,
    reporter: ctx.authorName,
    subject: detail.title,
    target: detail.target || ctx.authorUnit || ctx.branchName || "",
    period,
    categories: REPORT_CATEGORIES.map((label) => ({ label, checked: detail.categories.includes(label) })),
    background: detail.background,
    cause: detail.cause,
    measures: detail.measures,
    implementedOn: detail.implementedOn ? slashDate(detail.implementedOn) : "",
    implementer: detail.implementer || people.join("、"),
    result: detail.result,
    followUp: detail.followUp,
    creator: ctx.authorName,
    confirmer: (ctx.confirmer ?? "").trim(),
    approver: (ctx.approver ?? "").trim(),
  };
}

/* ===================== Word（.docx）の書き出し ===================== */

const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT = '<w:rFonts w:ascii="Yu Mincho" w:hAnsi="Yu Mincho" w:eastAsia="游明朝" w:cs="Yu Mincho"/>';

interface RunOpts { bold?: boolean; size?: number; spacing?: number }

/** 改行つきの文字を、Word の run にする */
function runs(text: string, o: RunOpts = {}): string {
  const rpr = `<w:rPr>${FONT}${o.bold ? "<w:b/><w:bCs/>" : ""}${o.spacing ? `<w:spacing w:val="${o.spacing}"/>` : ""}${o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : ""}</w:rPr>`;
  return text
    .split("\n")
    .map((line, i) => `<w:r>${rpr}${i > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
    .join("");
}

interface ParaOpts extends RunOpts { align?: "left" | "center" | "right"; after?: number; tabRight?: number; keepNext?: boolean }

function para(text: string, o: ParaOpts = {}): string {
  const ppr = `<w:pPr>${o.keepNext ? "<w:keepNext/>" : ""}${o.tabRight ? `<w:tabs><w:tab w:val="right" w:pos="${o.tabRight}"/></w:tabs>` : ""}<w:spacing w:before="0" w:after="${o.after ?? 0}"/>${o.align ? `<w:jc w:val="${o.align}"/>` : ""}</w:pPr>`;
  return `<w:p>${ppr}${runs(text, o)}</w:p>`;
}

/** 左と右に分けて置く1行（宛先と報告者など） */
function paraLeftRight(left: string, right: string, width: number, o: RunOpts = {}): string {
  const rpr = `<w:rPr>${FONT}${o.size ? `<w:sz w:val="${o.size}"/>` : ""}</w:rPr>`;
  return `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${width}"/></w:tabs><w:spacing w:before="0" w:after="160"/></w:pPr>${runs(left, o)}<w:r>${rpr}<w:tab/></w:r>${runs(right, o)}</w:p>`;
}

const COL = 1600; // 6列 × 1600 = 9600 twips（A4・余白2cmの本文幅にほぼ一致）
const TABLE_W = COL * 6;

interface Cell { span: number; text?: string; paras?: string; fill?: string; bold?: boolean; center?: boolean; size?: number; keepNext?: boolean }

function cell(c: Cell): string {
  const inner = c.paras ?? para(c.text ?? "", { bold: c.bold, size: c.size ?? 20, align: c.center ? "center" : undefined, keepNext: c.keepNext });
  return `<w:tc><w:tcPr><w:tcW w:w="${COL * c.span}" w:type="dxa"/>${c.span > 1 ? `<w:gridSpan w:val="${c.span}"/>` : ""}${c.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>` : ""}<w:vAlign w:val="${c.center ? "center" : "top"}"/></w:tcPr>${inner}</w:tc>`;
}

function row(cells: Cell[], minHeight = 0): string {
  return `<w:tr><w:trPr><w:cantSplit/>${minHeight ? `<w:trHeight w:val="${minHeight}" w:hRule="atLeast"/>` : ""}</w:trPr>${cells.map(cell).join("")}</w:tr>`;
}

const LABEL = "F1F2F6";
const BAND = "E3E6EE";

const label = (text: string, span = 1): Cell => ({ span, text, fill: LABEL, center: true, size: 18 });
const band = (text: string): Cell => ({ span: 6, text, fill: BAND, bold: true, keepNext: true });
const body = (text: string): Cell => ({ span: 6, text });

export function buildReportBodyXml(d: ReportDocument): string {
  const checkLine = (a: string, b?: string) => {
    const box = (label: string) => `${d.categories.find((c) => c.label === label)?.checked ? "☑" : "□"} ${label}`;
    return para([box(a), b ? box(b) : ""].filter(Boolean).join("　"), { size: 19 });
  };
  const categoryCell: Cell = {
    span: 2,
    paras: checkLine("業務改善", "品質改善") + checkLine("クレーム対応", "事故・トラブル対応") + checkLine("その他"),
  };

  const table = `<w:tbl>
<w:tblPr><w:tblW w:w="${TABLE_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/>
<w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="444B5A"/><w:left w:val="single" w:sz="6" w:space="0" w:color="444B5A"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="444B5A"/><w:right w:val="single" w:sz="6" w:space="0" w:color="444B5A"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="8A91A0"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="8A91A0"/></w:tblBorders>
<w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>
<w:tblGrid>${'<w:gridCol w:w="1600"/>'.repeat(6)}</w:tblGrid>
${row([label("件名"), { span: 5, text: d.subject }], 440)}
${row([label("対象業務・部署"), { span: 5, text: d.target }], 440)}
${row([label("改善実施期間"), { span: 2, text: d.period }, label("改善区分"), categoryCell], 900)}
${row([band("1. 背景・現状（問題点）")])}
${row([body(d.background)], 700)}
${row([band("2. 原因分析（直接原因・根本原因）")])}
${row([body(d.cause)], 700)}
${row([band("3. 改善策・実施した対策")])}
${row([body(d.measures)], 900)}
${row([label("実施日"), { span: 2, text: d.implementedOn }, label("実施担当"), { span: 2, text: d.implementer }], 440)}
${row([band("4. 実施結果・効果")])}
${row([body(d.result)], 700)}
${row([band("5. 考察・再発防止・今後の対応")])}
${row([body(d.followUp)], 700)}
${row([band("確認・承認")])}
${row([
    { span: 2, paras: para("作成者", { size: 18 }) + para(d.creator, { size: 20 }) + para("印", { size: 16, align: "right" }) },
    { span: 2, paras: para("確認者", { size: 18 }) + para(d.confirmer, { size: 20 }) + para("印", { size: 16, align: "right" }) },
    { span: 2, paras: para("承認者", { size: 18 }) + para(d.approver, { size: 20 }) + para("印", { size: 16, align: "right" }) },
  ], 900)}
</w:tbl>`.replace(/\n/g, ""); // 表のXMLの見やすさのための改行は除く（文中の改行は <w:br/> で表しているので影響しない）

  return [
    para("改 善 報 告 書", { align: "center", bold: true, size: 40, spacing: 60, after: 200 }),
    para(`報告日：${d.reportDate}　　文書番号：${d.docNumber}`, { align: "right", size: 20, after: 200 }),
    paraLeftRight(d.addressee, d.reporter, TABLE_W, { size: 22 }),
    table,
    // 表のあとには、必ず段落が必要（Word の決まり）
    para("", { size: 2 }),
  ].join("");
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function buildReportDocx(d: ReportDocument): Uint8Array {
  const enc = new TextEncoder();
  const xml = (s: string) => enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`);

  const contentTypes = xml(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      "</Types>",
  );
  const rels = xml(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>",
  );
  const docRels = xml(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>",
  );
  const styles = xml(
    `<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault>` +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="280" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>',
  );
  const core = xml(
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${esc(`改善報告書 ${d.docNumber}`)}</dc:title><dc:creator>${esc(d.creator)}</dc:creator>` +
      "</cp:coreProperties>",
  );
  const document = xml(
    `<w:document ${W_NS}><w:body>${buildReportBodyXml(d)}` +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="1134" w:bottom="800" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>",
  );

  return zipStore([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: document },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/styles.xml", data: styles },
    { name: "docProps/core.xml", data: core },
  ]);
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** ダウンロードするファイル名（使えない文字は除く） */
export function reportFileName(d: ReportDocument): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\r\n]/g, "").trim().slice(0, 30);
  return `改善報告書_${d.docNumber}_${safe(d.subject) || "無題"}.docx`;
}
