import { useState } from "react";
import { DEPT_LABEL } from "@tsunagari/shared";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";
import { Avatar, ErrorBox, Loading } from "../components/common";

export function Home() {
  const { me, people, openCard, dataVersion, bumpData } = useApp();
  const floor = useAsync(() => api.floor(me.branchId), [dataVersion]);
  const kaizen = useAsync(() => api.posts("kaizen"), [dataVersion]);
  const news = useAsync(() => api.posts("hitokoto"), [dataVersion]);
  const official = useAsync(() => api.posts("official"), [dataVersion]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (floor.loading) return <Loading />;
  if (floor.error || !floor.data) return <ErrorBox error={floor.error} />;

  const { seats, assignments, branch } = floor.data;
  const mySeat = seats.find((s) => assignments[s.id]?.includes(me.id));
  const neighbors = mySeat
    ? (assignments[mySeat.id] ?? []).filter((id) => id !== me.id).map((id) => people.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
    : [];
  const depts = [...new Set(neighbors.map((n) => DEPT_LABEL[n.dept]))].join("・");
  const totalCapacity = seats.reduce((n, s) => n + s.capacity, 0);
  const occupied = Object.values(assignments).reduce((n, ids) => n + ids.length, 0);
  const picked = news.data?.find((p) => p.pickedForNews);
  const latestOfficial = official.data?.[0];
  const moving = kaizen.data?.find((p) => p.status === "inProgress");

  const draw = async () => {
    setBusy(true); setError(null);
    try { await api.draw(); bumpData(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const leave = async () => {
    setBusy(true); setError(null);
    try { await api.checkOut(); bumpData(); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="today-seat">
        {mySeat && <button className="leave-btn" onClick={leave} disabled={busy}>退席</button>}
        {mySeat ? (
          <>
            <div><div className="big">{mySeat.label}</div><div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>{branch.name} {mySeat.floor}</div></div>
            <p>
              {neighbors.length > 0 ? `今日の席が決まりました。同じ席には ${depts} のメンバーがいます。` : "今日の席が決まりました。"}
              <br /><span className="vacancy">空席 {totalCapacity - occupied}/{totalCapacity}</span>
            </p>
          </>
        ) : (
          <div style={{ width: "100%" }}>
            <p style={{ marginBottom: 10 }}>出社したら「抽選する」を押してください。グループ席から優先して割り当てます。</p>
            <button className="draw-btn" onClick={draw} disabled={busy}>{busy ? "抽選中…" : "抽選する"}</button>
            <div className="vacancy" style={{ marginTop: 8 }}>空席 {totalCapacity - occupied}/{totalCapacity}</div>
          </div>
        )}
      </div>
      <ErrorBox error={error} />
      {neighbors.length > 0 && (
        <>
          <div className="sec-title">今日のおとなり</div>
          <div className="neigh">
            {neighbors.map((n) => (
              <button key={n.id} onClick={() => openCard(n.id)}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}><Avatar person={n} /></div>
                <div style={{ fontWeight: 700 }}>{n.nickname}さん</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{n.skills[0] ?? n.unit}</div>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="sec-title">あなた向けの今日の3件</div>
      <div className="panel">
        {latestOfficial && <div className="feed-item"><span className="chip">公式</span><div><b>{latestOfficial.body.slice(0, 32)}</b><div className="muted">本部からのお知らせ</div></div></div>}
        {picked && <div className="feed-item"><span className="chip">社内ニュース</span><div><b>{picked.body.slice(0, 32)}</b><div className="muted">ひとこと投稿から採用</div></div></div>}
        {moving && <div className="feed-item"><span className="chip">改善</span><div>「{moving.body.slice(0, 20)}…」が<b>対応中</b>になりました</div></div>}
        <div className="feed-item"><span className="chip">拠点</span><div>今日の{branch.name}には <b>{occupied}人</b> が着席しています</div></div>
      </div>
    </>
  );
}
