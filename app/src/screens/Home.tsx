import { useState } from "react";
import { DEPT_LABEL, pickTopics } from "@tsunagari/shared";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";
import { Avatar, ErrorBox, Loading } from "../components/common";
import { BranchPicker } from "../components/BranchPicker";
import { Gallery } from "../components/Gallery";
import { NewsPanel } from "../components/NewsPanel";
import { Tasks } from "../components/Tasks";

export function Home() {
  const { me, people, openCard, dataVersion, bumpData, toast, workBranch: branchId, setWorkBranch: setBranchId } = useApp();
  const floor = useAsync(() => api.floor(branchId), [dataVersion, branchId]);
  const news = useAsync(() => api.posts("hitokoto"), [dataVersion]);
  const official = useAsync(() => api.posts("official"), [dataVersion]);
  const tasks = useAsync(() => api.tasks(), [dataVersion]);
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (floor.loading && !floor.data) return <Loading />;
  if (floor.error || !floor.data) return <ErrorBox error={floor.error} />;

  const { seats, assignments, branch, counts } = floor.data;
  const mySeat = seats.find((s) => assignments[s.id]?.includes(me.id));
  const neighbors = mySeat
    ? (assignments[mySeat.id] ?? []).filter((id) => id !== me.id).map((id) => people.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
    : [];
  const depts = [...new Set(neighbors.map((n) => DEPT_LABEL[n.dept]))].join("・");
  const totalCapacity = seats.reduce((n, s) => n + s.capacity, 0);
  // 空席の数は、座席マップに出さない設定の人も含めた実際の人数で数える
  const occupied = Object.values(counts).reduce((n, c) => n + c, 0);
  // 支店ニュースのランダムは、日付と本人で固定する（画面を開き直しても急に変わらない）
  const seed = [...`${new Date().toDateString()}${me.id}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const topics = pickTopics({ tasks: tasks.data ?? [], official: official.data ?? [], hitokoto: news.data ?? [], branchId: me.branchId, seed });

  // 抽選中は席番号がくるくる変わる演出を出す（結果が早く返っても、少し見せてから確定する）
  const draw = async () => {
    setBusy(true); setError(null);
    // 抽選中に回る番号は、いま空いている席だけ（埋まっている席は出さない）
    const labels = seats.filter((s) => s.type === "normal" && (counts[s.id] ?? 0) < s.capacity).map((s) => s.label);
    let i = 0;
    const timer = setInterval(() => setRolling(labels[i++ % labels.length] ?? "?"), 90);
    try {
      const [{ seat }] = await Promise.all([api.draw(branchId), new Promise((r) => setTimeout(r, 1000))]);
      setBranchId(seat.branchId);
      // 結果を受け取った瞬間に、座席の表示へ反映する。最新の状態の取り直しを待つあいだ、「抽選する」が出直して押し直してしまわないように
      floor.setData((f) => f && {
        ...f,
        assignments: { ...f.assignments, [seat.id]: [...(f.assignments[seat.id] ?? []).filter((id) => id !== me.id), me.id] },
        counts: { ...f.counts, [seat.id]: (f.counts[seat.id] ?? 0) + 1 },
      });
      bumpData();
      toast(`${seat.label}番の席に決まりました`);
    } catch (e) { setError(e); } finally { clearInterval(timer); setRolling(null); setBusy(false); }
  };
  const leave = async () => {
    setBusy(true); setError(null);
    try {
      await api.checkOut();
      // 退席も、すぐ表示に反映する
      floor.setData((f) => f && {
        ...f,
        assignments: Object.fromEntries(Object.entries(f.assignments).map(([k, ids]) => [k, ids.filter((id) => id !== me.id)])),
        counts: mySeat ? { ...f.counts, [mySeat.id]: Math.max(0, (f.counts[mySeat.id] ?? 1) - 1) } : f.counts,
      });
      bumpData(); toast("退席しました。お疲れさまでした");
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <>
      <BranchPicker disabled={busy || !!mySeat} />
      <div className="today-seat">
        {mySeat && <button className="leave-btn" onClick={leave} disabled={busy}>退席</button>}
        {mySeat ? (
          <>
            <div><div className="big pop-in" key={mySeat.id}>{mySeat.label}</div><div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>{branch.name} {mySeat.floor}</div></div>
            <p>
              {neighbors.length > 0 ? `今日の席が決まりました。同じ席には ${depts} のメンバーがいます。` : "今日の席が決まりました。"}
              <br /><span className="vacancy">空席 {totalCapacity - occupied}/{totalCapacity}</span>
            </p>
          </>
        ) : (
          <div style={{ width: "100%" }}>
            {rolling !== null ? (
              <div className="rolling" role="status" aria-label="抽選中">
                <div className="big roll-num" key={rolling}>{rolling}</div>
                <p>席を決めています…</p>
              </div>
            ) : (
              <>
                <p style={{ marginBottom: 10 }}>上で今日働く支店を選び、「抽選する」を押してください。グループ席から優先して割り当てます。席は、ボタンを押すまで決まりません。</p>
                <button className="draw-btn" onClick={draw} disabled={busy}>抽選する</button>
                <div className="vacancy" style={{ marginTop: 8 }}>空席 {totalCapacity - occupied}/{totalCapacity}</div>
              </>
            )}
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
                <div style={{ fontWeight: 700 }}>{n.fullName}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{n.skills[0] ?? n.unit}</div>
              </button>
            ))}
          </div>
        </>
      )}
      <Tasks />
      <NewsPanel />
      <Gallery />
      {topics.length > 0 && (
        <>
          <div className="sec-head"><div className="sec-title">トピックス</div></div>
          <div className="panel">
            {topics.map((tp) => (
              <div className="feed-item" key={tp.kind}>
                <span className={`chip topic-${tp.kind}`}>{tp.label}</span>
                <div><b>{tp.text}</b>{tp.sub && <div className="muted">{tp.sub}</div>}</div>
              </div>
            ))}
          </div>
        </>
      )}    </>
  );
}
