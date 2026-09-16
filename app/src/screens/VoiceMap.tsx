import { useState } from "react";
import { api, type BranchStat } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { ErrorBox, Loading, Segmented } from "../components/common";

type Mode = "all" | "kaizen" | "cross";

export function VoiceMap() {
  const [mode, setMode] = useState<Mode>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const q = useAsync(() => api.voiceMap(), []);
  if (q.loading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const { branches, stats, collaborations } = q.data;
  const statOf = (id: string) => stats.find((s) => s.branchId === id)!;
  const linked = new Set(collaborations.flat());
  const pos = new Map(branches.map((b) => [b.id, b]));
  const sel = selected ? statOf(selected) : null;
  const selBranch = selected ? pos.get(selected) : null;

  return (
    <>
      <Segmented value={mode} onChange={(m) => setMode(m)} options={[["all", "すべて"], ["kaizen", "改善"], ["cross", "部門をこえた声"]]} />
      <div className="map-wrap">
        <svg viewBox="0 0 360 420" role="img" aria-label="拠点別の声のマップ">
          <path d="M130 30 L205 25 L250 60 L260 120 L285 170 L290 250 L270 320 L230 380 L165 400 L105 370 L80 300 L90 230 L70 170 L85 100 Z" fill="#EEF2EA" stroke="#C9D3BF" strokeWidth={2} />
          <text x={250} y={410} fontSize={11} fill="#8A93A0">奈良県（模式図）</text>
          {mode !== "kaizen" && collaborations.filter(([a, b]) => a !== b).map(([a, b]) => {
            const A = pos.get(a), B = pos.get(b);
            if (!A || !B) return null;
            return <line key={`${a}-${b}`} x1={A.mapX} y1={A.mapY} x2={B.mapX} y2={B.mapY} stroke="var(--wakakusa)" strokeWidth={mode === "cross" ? 4 : 2.5} strokeDasharray={mode === "cross" ? undefined : "5 4"} opacity={0.8} />;
          })}
          {branches.map((b) => {
            const s = statOf(b.id);
            if (mode === "cross" && !linked.has(b.id)) return <circle key={b.id} cx={b.mapX} cy={b.mapY} r={7} fill="#C5CBD2" />;
            const segs: [number, string][] = mode === "kaizen" ? [[s.kaizen, "var(--ai)"]] : [[s.sales, "var(--sales)"], [s.eng, "var(--eng)"], [s.office, "var(--office)"]];
            const total = segs.reduce((a, [v]) => a + v, 0);
            const r = 8 + Math.sqrt(total) * 5;
            return (
              <g key={b.id} onClick={() => setSelected(b.id)} style={{ cursor: "pointer" }} role="button" aria-label={`${b.name} 投稿${total}件`}>
                {total === 0 ? <circle cx={b.mapX} cy={b.mapY} r={8} fill="#C5CBD2" /> : <Pie x={b.mapX} y={b.mapY} r={r} segs={segs} total={total} />}
                <circle cx={b.mapX} cy={b.mapY} r={r} fill="transparent" stroke={selected === b.id ? "var(--ink)" : "#fff"} strokeWidth={2} />
                <text x={b.mapX} y={b.mapY + r + 13} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1E2430">{b.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="muted" style={{ margin: "6px 2px 0" }}>位置は模式図です。円の大きさ＝投稿数、線＝営業とエンジニアの共同提案。</p>
      <div className="sec-title">{selBranch ? `${selBranch.name}の声` : "拠点をタップ"}</div>
      {sel && selBranch ? <BranchDetail stat={sel} /> : <div className="panel muted">地図上の拠点を選ぶと、部門別の内訳と最近の声が表示されます。</div>}
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

function BranchDetail({ stat }: { stat: BranchStat }) {
  const t = stat.sales + stat.eng + stat.office || 1;
  return (
    <div className="panel">
      <div style={{ fontSize: 13 }}>投稿 <b>{stat.sales + stat.eng + stat.office}</b>件 ・ 改善 <b>{stat.kaizen}</b>件</div>
      <div className="bar">
        <div style={{ width: `${(stat.sales / t) * 100}%`, background: "var(--sales)" }} />
        <div style={{ width: `${(stat.eng / t) * 100}%`, background: "var(--eng)" }} />
        <div style={{ width: `${(stat.office / t) * 100}%`, background: "var(--office)" }} />
      </div>
      <div className="muted"><i className="dot d-sales" />営業 {stat.sales}　<i className="dot d-eng" />エンジニア {stat.eng}　<i className="dot d-office" />事務・本部 {stat.office}</div>
      {stat.latest.length > 0 && <div style={{ fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>最近の声：{stat.latest.join("／")}</div>}
      {stat.sales + stat.eng + stat.office < 5 && <div className="route" style={{ marginTop: 10 }}>投稿が少ない拠点です。広報担当に取材依頼を出せます。</div>}
    </div>
  );
}
