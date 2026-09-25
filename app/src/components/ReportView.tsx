import { useMemo, useState } from "react";
import { DOCX_MIME, buildReportDocx, reportFileName, reportNumber, toReportDocument, type Post, type ReportDocument } from "@tsunagari/shared";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { downloadFile } from "../lib/download";
import { useAsync } from "../lib/useAsync";
import { ErrorBox } from "./common";

/** 業務改善報告を、会社の「改善報告書」の形で見せる。アプリに書いた内容が、自動で報告書の項目に入る */
export function ReportView({ post }: { post: Post }) {
  const { people, toast } = useApp();
  const reports = useAsync(() => api.posts("report"), []);
  const branches = useAsync(() => api.branches(), []);
  const [dept, setDept] = useState("");
  const [name, setName] = useState("");
  const [confirmer, setConfirmer] = useState("");
  const [approver, setApprover] = useState("");
  const [error, setError] = useState<unknown>(null);

  const author = post.authorId ? people.get(post.authorId) : undefined;
  const doc = useMemo(
    () =>
      toReportDocument(post, {
        authorName: author?.fullName ?? "（匿名）",
        authorUnit: author?.unit,
        branchName: branches.data?.find((b) => b.id === post.branchId)?.name,
        coAuthorNames: (post.coAuthorIds ?? []).map((id) => people.get(id)?.fullName).filter((n): n is string => !!n),
        docNumber: reportNumber(post, reports.data ?? [post]),
        addresseeDept: dept, addresseeName: name, confirmer, approver,
      }),
    [post, author, branches.data, reports.data, people, dept, name, confirmer, approver],
  );

  const download = () => {
    setError(null);
    try {
      downloadFile(reportFileName(doc), buildReportDocx(doc), DOCX_MIME);
      toast("Word（.docx）で保存しました");
    } catch (e) { setError(e); }
  };

  return (
    <div className="rep-view">
      <div style={{ fontWeight: 800, fontSize: 15 }}>改善報告書</div>
      <p className="muted" style={{ marginTop: 2 }}>アプリに書いた内容が、会社の様式の項目に自動で入っています。宛先などは、必要なときだけ入力してください。</p>

      <ReportPreview doc={doc} />

      <div className="rep-extras">
        <div className="field"><label htmlFor="rp-dept">宛先の部署（任意）</label><input id="rp-dept" value={dept} maxLength={30} onChange={(e) => setDept(e.target.value)} placeholder="例：品質管理部" /></div>
        <div className="field"><label htmlFor="rp-name">宛先の氏名（任意）</label><input id="rp-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="例：山田 太郎" /></div>
        <div className="field"><label htmlFor="rp-conf">確認者（任意）</label><input id="rp-conf" value={confirmer} maxLength={30} onChange={(e) => setConfirmer(e.target.value)} /></div>
        <div className="field"><label htmlFor="rp-appr">承認者（任意）</label><input id="rp-appr" value={approver} maxLength={30} onChange={(e) => setApprover(e.target.value)} /></div>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>空欄のところは、Wordで開いてから書き込めます。押印の欄は空けてあります。</p>
      <ErrorBox error={error} />
      <button type="button" className="primary" onClick={download}>Word（.docx）でダウンロード</button>
    </div>
  );
}

/** 画面での表示。Word に書き出すものと同じ項目・同じ並び */
export function ReportPreview({ doc }: { doc: ReportDocument }) {
  const check = (label: string) => `${doc.categories.find((c) => c.label === label)?.checked ? "☑" : "□"} ${label}`;
  return (
    <div className="rep-paper" role="document" aria-label="改善報告書のプレビュー">
      <h2 className="rep-title">改 善 報 告 書</h2>
      <div className="rep-meta">報告日：{doc.reportDate}　　文書番号：{doc.docNumber}</div>
      <div className="rep-to"><span>{doc.addressee}</span><span>{doc.reporter}</span></div>
      <table className="rep">
        <colgroup>{Array.from({ length: 6 }).map((_, i) => <col key={i} style={{ width: "16.66%" }} />)}</colgroup>
        <tbody>
          <tr><th>件名</th><td colSpan={5}>{doc.subject}</td></tr>
          <tr><th>対象業務・部署</th><td colSpan={5}>{doc.target}</td></tr>
          <tr>
            <th>改善実施期間</th><td colSpan={2}>{doc.period}</td>
            <th>改善区分</th>
            <td colSpan={2} className="rep-checks">
              <div>{check("業務改善")}　{check("品質改善")}</div>
              <div>{check("クレーム対応")}　{check("事故・トラブル対応")}</div>
              <div>{check("その他")}</div>
            </td>
          </tr>
          <Section title="1. 背景・現状（問題点）" text={doc.background} />
          <Section title="2. 原因分析（直接原因・根本原因）" text={doc.cause} />
          <Section title="3. 改善策・実施した対策" text={doc.measures} />
          <tr><th>実施日</th><td colSpan={2}>{doc.implementedOn}</td><th>実施担当</th><td colSpan={2}>{doc.implementer}</td></tr>
          <Section title="4. 実施結果・効果" text={doc.result} />
          <Section title="5. 考察・再発防止・今後の対応" text={doc.followUp} />
          <tr><td className="rep-band" colSpan={6}>確認・承認</td></tr>
          <tr className="rep-sign">
            <td colSpan={2}><small>作成者</small><div>{doc.creator}</div><em>印</em></td>
            <td colSpan={2}><small>確認者</small><div>{doc.confirmer}</div><em>印</em></td>
            <td colSpan={2}><small>承認者</small><div>{doc.approver}</div><em>印</em></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <>
      <tr><td className="rep-band" colSpan={6}>{title}</td></tr>
      <tr><td className="rep-body" colSpan={6}>{text}</td></tr>
    </>
  );
}
