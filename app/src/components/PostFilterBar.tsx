import { DEPT_LABEL, activeFilterCount, type Branch, type Dept, type PostFilter, type PostKind, type PostPeriod, type PostSort, type PostStatusFilter } from "@tsunagari/shared";
import { Switch } from "./common";

const STATUS_OPTIONS: Record<PostKind, [PostStatusFilter, string][]> = {
  kaizen: [["all", "すべて"], ["done", "解決済み"], ["progress", "対応中"]],
  hitokoto: [["all", "すべて"], ["shared", "共有済み"], ["unshared", "まだ共有していない"]],
  official: [["all", "すべて"]],
};
const PERIOD_OPTIONS: [PostPeriod, string][] = [["all", "すべて"], ["week", "直近1週間"], ["month", "直近1か月"]];
const SORT_OPTIONS: [PostSort, string][] = [["new", "新しい順"], ["reactions", "拍手が多い順"]];
const DEPT_OPTIONS: [Dept | "all", string][] = [["all", "すべて"], ["sales", DEPT_LABEL.sales], ["eng", DEPT_LABEL.eng], ["office", DEPT_LABEL.office]];

function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="fchips" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

interface Props {
  kind: PostKind;
  categories: string[];
  branches: Branch[];
  filter: PostFilter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<PostFilter>) => void;
  onClear: () => void;
  shown: number;
  total: number;
}

/** 声の絞り込み。検索欄と、開閉できる条件パネル、選んだ条件のタグ（×で1つずつ外せる）からなる */
export function PostFilterBar({ kind, categories, branches, filter, open, onOpenChange, onChange, onClear, shown, total }: Props) {
  const count = activeFilterCount(filter);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id;

  const tags: { key: string; label: string; remove: () => void }[] = [];
  if (filter.category) tags.push({ key: "category", label: filter.category, remove: () => onChange({ category: null }) });
  if (filter.branchId) tags.push({ key: "branch", label: branchName(filter.branchId), remove: () => onChange({ branchId: null }) });
  if (filter.status !== "all") tags.push({ key: "status", label: STATUS_OPTIONS[kind].find(([v]) => v === filter.status)?.[1] ?? filter.status, remove: () => onChange({ status: "all" }) });
  if (filter.period !== "all") tags.push({ key: "period", label: PERIOD_OPTIONS.find(([v]) => v === filter.period)![1], remove: () => onChange({ period: "all" }) });
  if (filter.dept) tags.push({ key: "dept", label: `${DEPT_LABEL[filter.dept]}の投稿`, remove: () => onChange({ dept: null }) });
  if (filter.mine) tags.push({ key: "mine", label: "自分の投稿", remove: () => onChange({ mine: false }) });
  if (filter.sort !== "new") tags.push({ key: "sort", label: SORT_OPTIONS.find(([v]) => v === filter.sort)![1], remove: () => onChange({ sort: "new" }) });
  const filtering = count > 0 || filter.q.trim() !== "";

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <div className="search-box">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input
            id="voice-search" type="search" value={filter.q} placeholder="声を検索（本文・投稿者・支店）" aria-label="声を検索"
            onChange={(e) => onChange({ q: e.target.value })}
          />
          {filter.q && <button type="button" className="clear-x" aria-label="検索語を消す" onClick={() => onChange({ q: "" })}>×</button>}
        </div>
        <button type="button" className={`filter-btn ${open ? "on" : ""}`} aria-expanded={open} aria-controls="filter-panel" onClick={() => onOpenChange(!open)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          絞り込み{count > 0 && <span className="badge">{count}</span>}
        </button>
      </div>

      <div id="filter-panel" className={`filter-panel ${open ? "open" : ""}`}>
        <div>
          <div className="filter-body">
            {kind !== "official" && (
              <div className="fgroup"><span className="flabel">状態</span><Chips label="状態" value={filter.status} options={STATUS_OPTIONS[kind]} onChange={(v) => onChange({ status: v })} /></div>
            )}
            <div className="fgroup">
              <span className="flabel">種類</span>
              <Chips label="種類" value={filter.category ?? "all"} options={[["all", "すべて"], ...categories.map((c): [string, string] => [c, c])]} onChange={(v) => onChange({ category: v === "all" ? null : v })} />
            </div>
            <div className="fgroup">
              <span className="flabel"><label htmlFor="filter-branch">支店</label></span>
              <select id="filter-branch" value={filter.branchId ?? ""} onChange={(e) => onChange({ branchId: e.target.value || null })}>
                <option value="">すべての支店</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="fgroup"><span className="flabel">期間</span><Chips label="期間" value={filter.period} options={PERIOD_OPTIONS} onChange={(v) => onChange({ period: v })} /></div>
            {kind !== "official" && (
              <div className="fgroup"><span className="flabel">投稿者の部門</span><Chips label="投稿者の部門" value={filter.dept ?? "all"} options={DEPT_OPTIONS} onChange={(v) => onChange({ dept: v === "all" ? null : v })} /></div>
            )}
            <div className="fgroup"><span className="flabel">並び順</span><Chips label="並び順" value={filter.sort} options={SORT_OPTIONS} onChange={(v) => onChange({ sort: v })} /></div>
            <div className="opt"><div>自分の投稿だけ</div><Switch on={filter.mine} label="自分の投稿だけ" onChange={(v) => onChange({ mine: v })} /></div>
            <div className="filter-actions">
              <button type="button" className="text-btn" disabled={!filtering} onClick={onClear}>条件をすべてクリア</button>
              <button type="button" className="primary" onClick={() => onOpenChange(false)}>{shown}件を見る</button>
            </div>
          </div>
        </div>
      </div>

      {filtering && (
        <div className="filter-tags" aria-live="polite">
          <span className="result-count"><b>{shown}</b>件 / 全{total}件</span>
          {tags.map((t) => (
            <button key={t.key} type="button" className="ftag" onClick={t.remove} aria-label={`${t.label}の条件を外す`}>{t.label}<span aria-hidden>×</span></button>
          ))}
          <button type="button" className="text-btn" onClick={onClear}>クリア</button>
        </div>
      )}
    </div>
  );
}
