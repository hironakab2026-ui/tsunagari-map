import { useEffect, useState } from "react";
import type { SeatGroupDef } from "@tsunagari/shared";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";
import { Avatar, ErrorBox, Loading, Segmented } from "../components/common";

export function Seats() {
  const { me, dataVersion } = useApp();
  const [tab, setTab] = useState<"map" | "config">("map");
  const [branchId, setBranchId] = useState(me.branchId);
  const branches = useAsync(() => api.branches(), [dataVersion]);
  const list = branches.data ?? [];
  const isAll = !!(me.roles?.includes("SeatManager") || me.roles?.includes("Admin"));
  const editable = list.filter((b) => isAll || b.seatAdminIds.includes(me.id));
  const canEdit = editable.some((b) => b.id === branchId);

  const picker = list.length > 1 && (
    <div className="branch-pick">
      <label htmlFor="seat-branch" className="muted">支店</label>
      <select id="seat-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
        {list.map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === me.branchId ? "（所属）" : ""}</option>)}
      </select>
    </div>
  );
  const showTabs = editable.length > 0;
  return (
    <>
      {showTabs && <Segmented value={tab} onChange={setTab} options={[["map", "今日の座席"], ["config", "座席の設定"]]} />}
      {picker}
      {tab === "config" && showTabs
        ? (canEdit ? <SeatConfigEditor key={branchId} branchId={branchId} /> : <p className="muted">この支店の座席設定を変更する権限がありません。</p>)
        : <FloorMap branchId={branchId} />}
    </>
  );
}
/** 定員が多いほど円卓を大きくする（アイコンが円からはみ出さないように） */
const groupSize = (capacity: number): React.CSSProperties => ({ "--d": `${capacity <= 4 ? 98 : capacity <= 6 ? 112 : capacity <= 9 ? 128 : capacity <= 14 ? 152 : 176}px` } as React.CSSProperties);

const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)));

function FloorMap({ branchId }: { branchId: string }) {
  const { me, people, openCard, dataVersion } = useApp();
  const [q, setQ] = useState("");
  const floor = useAsync(() => api.floor(branchId), [dataVersion, branchId]);
  if (floor.loading && !floor.data) return <Loading />;
  if (floor.error || !floor.data) return <ErrorBox error={floor.error} />;
  const { seats, assignments, branch } = floor.data;

  const groupSeats = seats.filter((s) => s.kind === "group").sort((a, b) => a.number - b.number);
  const privateSeats = seats.filter((s) => s.kind === "private").sort((a, b) => a.number - b.number);
  const query = q.trim();
  const isHit = (pid: string) => {
    const p = people.get(pid);
    return !!(query && p && [...p.skills, p.unit].some((s) => s.includes(query)));
  };
  const seatedCount = Object.values(assignments).reduce((n, ids) => n + ids.length, 0);

  return (
    <>
      <div className="search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="得意なことで探す（例：EV、保険）" aria-label="得意なことで探す" />
      </div>
      <div className="floor">
        <div className="floor-head">
          <span>{branch.name} {seats[0]?.floor}</span>
          <span>着席 {seatedCount}人</span>
        </div>

        {groupSeats.length > 0 && (
          <>
            <div className="lbl-row">グループ席</div>
            <div className="group-seats">
              {groupSeats.map((s) => {
                const occupants = (assignments[s.id] ?? []).map((id) => people.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
                const full = occupants.length >= s.capacity;
                const anyHit = occupants.some((p) => isHit(p.id));
                return (
                  <div key={s.id} className={`seat-group ${full ? "full" : ""} ${anyHit ? "hit" : ""} ${s.capacity > 9 ? "dense" : ""}`} style={groupSize(s.capacity)}>
                    <span className="num">{s.label}</span>
                    <div className="slots">
                      {occupants.map((p) => (
                        <button key={p.id} onClick={() => openCard(p.id)} aria-label={`${p.nickname}さん`} className={p.id === me.id ? "me" : ""}>
                          <Avatar person={p} size={22} />
                        </button>
                      ))}
                      {Array.from({ length: s.capacity - occupants.length }).map((_, i) => (
                        <span key={i} className="slot-empty" />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {privateSeats.length > 0 && (
          <>
            <div className="lbl-row">プライベート席</div>
            <div className="private-seats">
              {privateSeats.map((s) => {
                const pid = (assignments[s.id] ?? [])[0];
                const p = pid ? people.get(pid) : undefined;
                if (!p) return <div key={s.id} className="seat empty"><div className="av">＋</div><div className="muted">{s.label}</div></div>;
                return (
                  <button key={s.id} className={`seat ${isHit(p.id) ? "hit" : ""} ${p.id === me.id ? "me" : ""}`} onClick={() => openCard(p.id)} aria-label={`${s.label} ${p.nickname}さん`}>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 3 }}><Avatar person={p} size={32} /></div>
                    <div style={{ fontWeight: 700 }}>{p.nickname}</div>
                    <div className="muted" style={{ fontSize: 9.5 }}>{s.label}</div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="legend">
          <span><i className="dot d-sales" />営業</span><span><i className="dot d-eng" />エンジニア</span><span><i className="dot d-office" />事務・本部</span>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>席をタップすると名刺が開きます。</p>
    </>
  );
}

function SeatConfigEditor({ branchId }: { branchId: string }) {
  const { me, toast, bumpData } = useApp();
  const cfg = useAsync(() => api.getSeatConfig(branchId), []);
  const admins = useAsync(() => api.seatAdmins(branchId), []);
  const people = useAsync(() => api.people(), []);
  const [groups, setGroups] = useState<SeatGroupDef[]>([]);
  const [privateCount, setPrivateCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [newAdminId, setNewAdminId] = useState("");
  const canManageAdmins = me.roles?.includes("SeatManager") || me.roles?.includes("Admin");

  useEffect(() => {
    if (cfg.data) { setGroups(cfg.data.groups); setPrivateCount(cfg.data.privateCount); }
  }, [cfg.data]);

  if (cfg.loading) return <Loading />;
  if (cfg.error) return <ErrorBox error={cfg.error} />;

  const save = async () => {
    setBusy(true); setError(null);
    try { await api.updateSeatConfig(branchId, { groups: groups.map((g) => ({ capacity: clampInt(g.capacity, 2, 20), count: clampInt(g.count, 0, 100) })), privateCount: clampInt(privateCount, 0, 200) }); bumpData(); toast("座席の設定を保存しました"); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="panel">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>グループ席</div>
        <p className="muted" style={{ marginBottom: 8 }}>何人用の席かと、その数を設定します。抽選ではグループ席から優先的に割り当てられます。</p>
        {groups.map((g, i) => (
          <div className="opt" key={i}>
            <div>
              <label className="muted" style={{ fontSize: 11 }}>定員（人）</label>
              <input type="number" min={2} value={g.capacity} style={{ width: 60, marginLeft: 6 }}
                onChange={(e) => setGroups(groups.map((x, j) => (i === j ? { ...x, capacity: Number(e.target.value) } : x)))} />
              <label className="muted" style={{ fontSize: 11, marginLeft: 14 }}>数</label>
              <input type="number" min={0} value={g.count} style={{ width: 50, marginLeft: 6 }}
                onChange={(e) => setGroups(groups.map((x, j) => (i === j ? { ...x, count: Number(e.target.value) } : x)))} />
            </div>
            <button className="text-btn" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>削除</button>
          </div>
        ))}
        <button className="secondary" onClick={() => setGroups([...groups, { capacity: 4, count: 1 }])}>＋ グループ席の種類を追加</button>

        <div style={{ fontSize: 13, fontWeight: 700, margin: "18px 0 4px" }}>プライベート席</div>
        <div className="opt">
          <div>1人用の席の数</div>
          <input type="number" min={0} value={privateCount} style={{ width: 60 }} onChange={(e) => setPrivateCount(Number(e.target.value))} />
        </div>

        <ErrorBox error={error} />
        <button className="primary" onClick={save} disabled={busy}>{busy ? "保存中…" : "保存する"}</button>
        <p className="muted" style={{ marginTop: 8 }}>設定を変更すると、本日の着席状況はリセットされます。</p>
      </div>

      {canManageAdmins && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>この拠点の座席管理者</div>
          {(admins.data ?? []).map((a) => (
            <div className="opt" key={a.id}>
              <div>{a.nickname || a.fullName}さん</div>
              <button className="text-btn" onClick={async () => { await api.removeSeatAdmin(branchId, a.id); admins.reload(); }}>削除</button>
            </div>
          ))}
          <div className="opt" style={{ gap: 8 }}>
            <select value={newAdminId} onChange={(e) => setNewAdminId(e.target.value)} style={{ flex: 1 }}>
              <option value="">追加する人を選ぶ</option>
              {(people.data ?? []).filter((p) => p.branchId === branchId).map((p) => (
                <option key={p.id} value={p.id}>{p.nickname || p.fullName}</option>
              ))}
            </select>
            <button className="text-btn" disabled={!newAdminId} onClick={async () => { await api.addSeatAdmin(branchId, newAdminId); setNewAdminId(""); admins.reload(); }}>追加</button>
          </div>
        </div>
      )}
    </>
  );
}
