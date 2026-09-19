import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";

/** 今日働く支店の選択。ホームと座席画面で同じ部品・同じ選択を使う */
export function BranchPicker({ disabled }: { disabled?: boolean }) {
  const { me, workBranch, setWorkBranch } = useApp();
  const branches = useAsync(() => api.branches(), []);
  return (
    <div className="branch-pick">
      <label htmlFor="work-branch">今日働く支店</label>
      <select id="work-branch" value={workBranch} onChange={(e) => setWorkBranch(e.target.value)} disabled={disabled}>
        {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === me.branchId ? "（所属）" : ""}</option>)}
      </select>
    </div>
  );
}