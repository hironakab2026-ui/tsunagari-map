import { useState } from "react";
import { IMPROVEMENT_FIELDS, postStatus, type Post, type PostStatusFilter } from "@tsunagari/shared";
import { api, type BranchStat } from "../lib/api";
import { useApp } from "../lib/context";
import { useTween } from "../lib/useTween";
import { useAsync } from "../lib/useAsync";
import { Avatar, ErrorBox, FieldChip, Loading, Segmented } from "../components/common";

/** 声＝要改善事項（これから直したいこと）と業務改善報告（すでに改善した事例）。ひとこと・公式は含めない */
type Mode = "all" | "issue" | "report";
const MODE_LABEL: Record<Exclude<Mode, "all">, string> = { issue: "要改善事項", report: "業務改善報告" };

/** 表示する種類の、分野ごとの件数 */
function fieldCounts(stat: BranchStat, mode: Mode): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (src: Record<string, number>) => { for (const [k, v] of Object.entries(src)) out[k] = (out[k] ?? 0) + v; };
  if (mode !== "report") add(stat.fields.issue);
  if (mode !== "issue") add(stat.fields.report);
  return out;
}
const sum = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

export function VoiceMap() {
  const [mode, setMode] = useState<Mode>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const q = useAsync(() => api.voiceMap(), []);
  // 種類を切り替えたとき、円の大きさと円グラフの割合が滑らかに変わるようにする
  const targets = (q.data?.branches ?? []).flatMap((b) => {
    const s = q.data!.stats.find((x) => x.branchId === b.id)!;
    const c = fieldCounts(s, mode);
    return IMPROVEMENT_FIELDS.map((f) => c[f.id] ?? 0);
  });
  const shownValues = useTween(targets);
  if (q.loading && !q.data) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const { branches, stats, collaborations } = q.data;
  const statOf = (id: string) => stats.find((s) => s.branchId === id)!;
  const F = IMPROVEMENT_FIELDS.length;
  const animatedCounts = (bi: number) => shownValues.slice(bi * F, bi * F + F);
  const maxTotal = Math.max(1, ...branches.map((_, bi) => animatedCounts(bi).reduce((a, b) => a + b, 0)));
  const pos = new Map(branches.map((b) => [b.id, b]));
  const selBranch = selected ? pos.get(selected) : null;

  return (
    <>
      <Segmented value={mode} onChange={(m) => setMode(m)} options={[["all", "すべて"], ["issue", MODE_LABEL.issue], ["report", MODE_LABEL.report]]} />
      <div className="map-wrap">
        <svg viewBox="0 0 360 420" role="img" aria-label="拠点別の声のマップ">
          <path d="M130 30 L205 25 L250 60 L260 120 L285 170 L290 250 L270 320 L230 380 L165 400 L105 370 L80 300 L90 230 L70 170 L85 100 Z" style={{ fill: "var(--oak-100)", stroke: "var(--oak-300)" }} strokeWidth={2} />
          <text x={250} y={410} fontSize={11} style={{ fill: "var(--muted)" }}>奈良県（模式図）</text>
          {/* つながり：一緒に取り組んだ人が別の拠点にいる声があれば、その拠点どうしを線で結ぶ */}
          {collaborations.filter(([a, b]) => a !== b).map(([a, b]) => {
            const A = pos.get(a), B = pos.get(b);
            if (!A || !B) return null;
            return <line key={`${a}-${b}`} x1={A.mapX} y1={A.mapY} x2={B.mapX} y2={B.mapY} stroke="var(--brand-deep)" strokeWidth={3} strokeDasharray="6 5" strokeLinecap="round" opacity={0.7} />;
          })}
          {branches.map((b, i) => {
            const anim = animatedCounts(i);
            const total = anim.reduce((a, c) => a + c, 0);
            const shownTotal = Math.round(sum(fieldCounts(statOf(b.id), mode)));
            // 円の大きさは、寄せられた声の数に応じて変える（いちばん多い拠点を最大にして、差がはっきり見えるようにする）
            const r = total < 0.05 ? 8 : 10 + 25 * Math.pow(total / maxTotal, 0.75);
            return (
              <g key={b.id} className="map-bubble" onClick={() => setSelected(b.id)} style={{ cursor: "pointer", animationDelay: `${i * 70}ms` }} role="button" aria-label={`${b.name} 声${shownTotal}件`}>
                {total < 0.05
                  ? <circle cx={b.mapX} cy={b.mapY} r={r} style={{ fill: "var(--oak-300)" }} />
                  : <Pie x={b.mapX} y={b.mapY} r={r} segs={IMPROVEMENT_FIELDS.map((f, fi): [number, string] => [anim[fi], f.color])} total={total} />}
                <circle cx={b.mapX} cy={b.mapY} r={r} fill="transparent" stroke={selected === b.id ? "var(--ink)" : "#fff"} strokeWidth={selected === b.id ? 3 : 2} style={{ transition: "stroke-width .2s" }} />
                {shownTotal > 0 && <text x={b.mapX} y={b.mapY + 5} textAnchor="middle" fontSize={r >= 20 ? 15 : 12} fontWeight={800} fill="#fff" stroke="rgba(36,27,20,.6)" strokeWidth={3} paintOrder="stroke" style={{ transition: "opacity .3s" }}>{shownTotal}</text>}
                <text x={b.mapX} y={b.mapY + r + 13} textAnchor="middle" fontSize={12} fontWeight={700} style={{ fill: "var(--ink)" }}>{b.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="field-legend" aria-label="分野の色">
        {IMPROVEMENT_FIELDS.map((f) => <span key={f.id}><i className="dot" style={{ background: f.color }} />{f.label}</span>)}
      </div>
      <p className="muted" style={{ margin: "6px 2px 0" }}>位置は模式図です。円の大きさと数字＝声の数、色＝分野、点線＝一緒に取り組んだ人がいる拠点どうしのつながり。</p>
      <div className="sec-title">{selBranch ? `${selBranch.name}の声` : "拠点をタップ"}</div>
      {selBranch ? <BranchDetail key={selBranch.id} stat={statOf(selBranch.id)} branchId={selBranch.id} mode={mode} /> : <div className="panel muted">地図上の拠点を選ぶと、分野ごとの内訳と、その拠点の声が1件ずつ表示されます。</div>}
    </>
  );
}

function Pie({ x, y, r, segs, total }: { x: number; y: number; r: number; segs: [number, string][]; total: number }) {
  let ang = -Math.PI / 2;
  return (
    <>
      {segs.map(([v, c], i) => {
        if (v < 0.001) return null;
        if (v >= total - 0.001) return <circle key={i} cx={x} cy={y} r={r} fill={c} />;
        const a2 = ang + (2 * Math.PI * v) / total;
        const large = a2 - ang > Math.PI ? 1 : 0;
        const d = `M${x} ${y} L${x + r * Math.cos(ang)} ${y + r * Math.sin(ang)} A${r} ${r} 0 ${large} 1 ${x + r * Math.cos(a2)} ${y + r * Math.sin(a2)} Z`;
        ang = a2;
        return <path key={i} d={d} fill={c} stroke="#fff" strokeWidth={1} />;
      })}
    </>
  );
}

type Filter = PostStatusFilter;
const FILTERS: [Filter, string][] = [["all", "すべて"], ["progress", "対応中"], ["done", "解決・改善済み"]];

function BranchDetail({ stat, branchId, mode }: { stat: BranchStat; branchId: string; mode: Mode }) {
  const { people, dataVersion, openReport } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const all = useAsync(async () => {
    const [k, r] = await Promise.all([api.posts("kaizen"), api.posts("report")]);
    return [...k, ...r];
  }, [dataVersion]);

  const counts = fieldCounts(stat, mode);
  const total = sum(counts) || 1;
  const inMode = (p: Post) => mode === "all" || (mode === "issue" ? p.kind === "kaizen" : p.kind === "report");
  const posts = (all.data ?? []).filter((p) => p.branchId === branchId && inMode(p)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shown = posts.filter((p) => filter === "all" || postStatus(p).tone === filter);
  const count = (f: Filter) => posts.filter((p) => f === "all" || postStatus(p).tone === f).length;
  const nameOf = (id: string) => people.get(id)?.fullName;

  return (
    <div className="branch-detail">
      <div className="panel">
        <div style={{ fontSize: 13 }}>要改善事項 <b>{stat.issue}</b>件 ・ 業務改善報告 <b>{stat.report}</b>件</div>
        <div className="bar" aria-hidden>
          {IMPROVEMENT_FIELDS.map((f) => <div key={f.id} style={{ width: `${((counts[f.id] ?? 0) / total) * 100}%`, background: f.color }} />)}
        </div>
        <div className="field-legend tight">
          {IMPROVEMENT_FIELDS.filter((f) => counts[f.id]).map((f) => <span key={f.id}><i className="dot" style={{ background: f.color }} />{f.label} {counts[f.id]}</span>)}
        </div>
        {sum(counts) < 5 && <div className="route" style={{ marginTop: 10 }}>声が少ない拠点です。改善した事例があれば、「声」の「業務改善報告」から共有してみましょう。</div>}
      </div>
      <div className="cats status-filter" role="group" aria-label="状態で絞り込み">
        {FILTERS.map(([f, label]) => <button key={f} className={f === filter ? "on" : ""} onClick={() => setFilter(f)}>{label} {count(f)}</button>)}
      </div>
      {all.loading && !all.data && <Loading />}
      {!all.loading && shown.length === 0 && <div className="panel muted">この条件の声はありません。</div>}
      {shown.map((p) => {
        const st = postStatus(p);
        const author = p.authorId ? people.get(p.authorId) ?? null : null;
        const together = (p.coAuthorIds ?? []).map(nameOf).filter(Boolean);
        return (
          <article className="post" key={p.id}>
            <div className="post-head">
              <Avatar person={author} size={30} />
              <div>
                <b>{author ? `${author.fullName}さん` : "匿名"}</b><br />
                <span className="muted">{new Date(p.createdAt).toLocaleDateString("ja-JP")} ・ {p.kind === "report" ? "業務改善報告" : "要改善事項"}</span>
              </div>
              <span className={`st-pill ${st.tone}`} style={{ marginLeft: "auto" }}>{st.label}</span>
            </div>
            {p.report && <div className="rep-headline">{p.report.title}</div>}
            <div>{p.report ? p.report.measures : p.body}</div>
            {p.effect && <div className="effect"><b>効果</b>{p.effect}</div>}
            <div className="post-foot">
              <FieldChip category={p.category} />
              {p.kind === "kaizen" && p.assignedTo && <span>担当：{p.assignedTo}</span>}
              {together.length > 0 && <span>一緒に：{together.join("・")}</span>}
            </div>
            {p.kind === "report" && <button type="button" className="secondary rep-open" onClick={() => openReport(p)}>改善報告書を表示・Wordでダウンロード</button>}
          </article>
        );
      })}
    </div>
  );
}
