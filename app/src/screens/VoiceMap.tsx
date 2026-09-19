import { useState } from "react";
import { postStatus, type Post, type PostStatusFilter } from "@tsunagari/shared";
import { api, type BranchStat } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";
import { Avatar, ErrorBox, Loading, Segmented } from "../components/common";

type Mode = "all" | "kaizen" | "cross";

export function VoiceMap() {
  const [mode, setMode] = useState<Mode>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const q = useAsync(() => api.voiceMap(), []);
  if (q.loading && !q.data) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const { branches, stats, collaborations } = q.data;
  const statOf = (id: string) => stats.find((s) => s.branchId === id)!;
  const linked = new Set(collaborations.flat());
  const pos = new Map(branches.map((b) => [b.id, b]));
  const totalOf = (id: string) => {
    const s = statOf(id);
    return mode === "kaizen" ? s.kaizen : s.sales + s.eng + s.office;
  };
  const maxTotal = Math.max(1, ...branches.map((b) => totalOf(b.id)));
  const sel = selected ? statOf(selected) : null;
  const selBranch = selected ? pos.get(selected) : null;

  return (
    <>
      <Segmented value={mode} onChange={(m) => setMode(m)} options={[["all", "すべて"], ["kaizen", "改善"], ["cross", "部門をこえた声"]]} />
      <div className="map-wrap">
        <svg viewBox="0 0 360 420" role="img" aria-label="拠点別の声のマップ">
          <path d="M130 30 L205 25 L250 60 L260 120 L285 170 L290 250 L270 320 L230 380 L165 400 L105 370 L80 300 L90 230 L70 170 L85 100 Z" style={{ fill: "var(--oak-100)", stroke: "var(--oak-300)" }} strokeWidth={2} />
          <text x={250} y={410} fontSize={11} style={{ fill: "var(--muted)" }}>奈良県（模式図）</text>
          {mode !== "kaizen" && collaborations.filter(([a, b]) => a !== b).map(([a, b]) => {
            const A = pos.get(a), B = pos.get(b);
            if (!A || !B) return null;
            return <line key={`${a}-${b}`} x1={A.mapX} y1={A.mapY} x2={B.mapX} y2={B.mapY} stroke="var(--wakakusa)" strokeWidth={mode === "cross" ? 4 : 2.5} strokeDasharray={mode === "cross" ? undefined : "5 4"} opacity={0.8} />;
          })}
          {branches.map((b, i) => {
            const s = statOf(b.id);
            if (mode === "cross" && !linked.has(b.id)) return <circle key={b.id} cx={b.mapX} cy={b.mapY} r={7} style={{ fill: "var(--oak-300)" }} />;
            const segs: [number, string][] = mode === "kaizen" ? [[s.kaizen, "var(--ai)"]] : [[s.sales, "var(--sales)"], [s.eng, "var(--eng)"], [s.office, "var(--office)"]];
            const total = segs.reduce((a, [v]) => a + v, 0);
            // 円の大きさは、寄せられた声の数に応じて変える（いちばん多い拠点を最大にして、差がはっきり見えるようにする）
            const r = total === 0 ? 8 : 10 + 25 * Math.pow(total / maxTotal, 0.75);
            return (
              <g key={b.id} className="map-bubble" onClick={() => setSelected(b.id)} style={{ cursor: "pointer", animationDelay: `${i * 70}ms` }} role="button" aria-label={`${b.name} 投稿${total}件`}>
                {total === 0 ? <circle cx={b.mapX} cy={b.mapY} r={8} style={{ fill: "var(--oak-300)" }} /> : <Pie x={b.mapX} y={b.mapY} r={r} segs={segs} total={total} />}
                <circle cx={b.mapX} cy={b.mapY} r={r} fill="transparent" stroke={selected === b.id ? "var(--ink)" : "#fff"} strokeWidth={selected === b.id ? 3 : 2} style={{ transition: "stroke-width .2s" }} />
                {total > 0 && <text x={b.mapX} y={b.mapY + 5} textAnchor="middle" fontSize={r >= 20 ? 15 : 12} fontWeight={800} fill="#fff" stroke="rgba(36,27,20,.55)" strokeWidth={3} paintOrder="stroke">{total}</text>}
                <text x={b.mapX} y={b.mapY + r + 13} textAnchor="middle" fontSize={12} fontWeight={700} style={{ fill: "var(--ink)" }}>{b.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="muted" style={{ margin: "6px 2px 0" }}>位置は模式図です。円の大きさ・数字＝寄せられた声の数、線＝営業とエンジニアの共同提案。</p>
      <div className="sec-title">{selBranch ? `${selBranch.name}の声` : "拠点をタップ"}</div>
      {sel && selBranch ? <BranchDetail key={selBranch.id} stat={sel} branchId={selBranch.id} mode={mode} /> : <div className="panel muted">地図上の拠点を選ぶと、部門別の内訳と、その拠点の声が1件ずつ状態つきで表示されます。</div>}
    </>
  );
}

function Pie({ x, y, r, segs, total }: { x: number; y: number; r: number; segs: [number, string][]; total: number }) {
  let ang = -Math.PI / 2;
  return (
    <>
      {segs.map(([v, c], i) => {
        if (!v) return null;
        if (v === total) return <circle key={i} cx={x} cy={y} r={r} fill={c} />;
        const a2 = ang + (2 * Math.PI * v) / total;
        const large = a2 - ang > Math.PI ? 1 : 0;
        const d = `M${x} ${y} L${x + r * Math.cos(ang)} ${y + r * Math.sin(ang)} A${r} ${r} 0 ${large} 1 ${x + r * Math.cos(a2)} ${y + r * Math.sin(a2)} Z`;
        ang = a2;
        return <path key={i} d={d} fill={c} />;
      })}
    </>
  );
}

type Filter = PostStatusFilter;
const statusOf = postStatus;

const KIND_LABEL = { hitokoto: "ひとこと", kaizen: "改善の声", official: "公式" } as const;
const FILTERS: [Filter, string][] = [["all", "すべて"], ["done", "解決済み"], ["progress", "対応中"], ["shared", "共有済み"], ["unshared", "未共有"]];

function BranchDetail({ stat, branchId, mode }: { stat: BranchStat; branchId: string; mode: Mode }) {
  const { me, people, dataVersion, bumpData, toast } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const canPick = !!me.roles?.some((r) => r === "PR" || r === "Admin");
  const all = useAsync(async () => {
    const [h, k, o] = await Promise.all([api.posts("hitokoto"), api.posts("kaizen"), api.posts("official")]);
    return [...h, ...k, ...o];
  }, [dataVersion]);

  const t = stat.sales + stat.eng + stat.office || 1;
  const inMode = (p: Post) => mode === "all" || (mode === "kaizen" && p.kind === "kaizen") || (mode === "cross" && p.kind === "kaizen" && (p.coAuthorIds?.length ?? 0) > 0);
  const posts = (all.data ?? []).filter((p) => p.branchId === branchId && inMode(p)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shown = posts.filter((p) => filter === "all" || statusOf(p).tone === filter);
  const count = (f: Filter) => posts.filter((p) => f === "all" || statusOf(p).tone === f).length;

  const pick = async (id: string) => {
    try { await api.pickForNews(id); bumpData(); toast("社内ニュースで共有しました"); } catch (e) { toast(e instanceof Error ? e.message : "共有できませんでした"); }
  };

  return (
    <>
      <div className="panel">
        <div style={{ fontSize: 13 }}>投稿 <b>{stat.sales + stat.eng + stat.office}</b>件 ・ 改善 <b>{stat.kaizen}</b>件</div>
        <div className="bar">
          <div style={{ width: `${(stat.sales / t) * 100}%`, background: "var(--sales)" }} />
          <div style={{ width: `${(stat.eng / t) * 100}%`, background: "var(--eng)" }} />
          <div style={{ width: `${(stat.office / t) * 100}%`, background: "var(--office)" }} />
        </div>
        <div className="muted"><i className="dot d-sales" />営業 {stat.sales}　<i className="dot d-eng" />エンジニア {stat.eng}　<i className="dot d-office" />事務・本部 {stat.office}</div>
        {stat.sales + stat.eng + stat.office < 5 && <div className="route" style={{ marginTop: 10 }}>投稿が少ない拠点です。広報担当に取材依頼を出せます。</div>}
      </div>
      <div className="cats status-filter" role="group" aria-label="状態で絞り込み">
        {FILTERS.map(([f, label]) => <button key={f} className={f === filter ? "on" : ""} onClick={() => setFilter(f)}>{label} {count(f)}</button>)}
      </div>
      {all.loading && <Loading />}
      {!all.loading && shown.length === 0 && <div className="panel muted">この条件の投稿はありません。</div>}
      {shown.map((p) => {
        const st = statusOf(p);
        const author = p.authorId ? people.get(p.authorId) ?? null : null;
        return (
          <article className="post" key={p.id}>
            <div className="post-head">
              <Avatar person={author} size={30} />
              <div>
                <b>{p.kind === "official" ? "本部広報" : author ? `${author.fullName}さん` : "匿名"}</b><br />
                <span className="muted">{new Date(p.createdAt).toLocaleDateString("ja-JP")} ・ {KIND_LABEL[p.kind]}</span>
              </div>
              <span className={`st-pill ${st.tone}`} style={{ marginLeft: "auto" }}>{st.label}</span>
            </div>
            <div>{p.body}</div>
            <div className="post-foot">
              <span>{p.category}</span>
              {p.kind === "kaizen" && p.assignedTo && <span>担当：{p.assignedTo}</span>}
              {p.mediaUrl && <span>{p.mediaType === "video" ? "動画あり" : "画像あり"}</span>}
              {canPick && p.kind === "hitokoto" && !p.pickedForNews && <button className="text-btn" onClick={() => pick(p.id)}>社内ニュースで共有する</button>}
            </div>
          </article>
        );
      })}
    </>
  );
}
