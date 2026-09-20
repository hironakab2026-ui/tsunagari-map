import { useEffect, type ReactNode } from "react";
import { DEPT_LABEL, fieldOf, type Dept, type Person } from "@tsunagari/shared";

export const DEPT_COLOR: Record<Dept, string> = {
  sales: "var(--sales)",
  eng: "var(--eng)",
  office: "var(--office)",
};

/** 顔写真・頭文字のアイコン。所属の色は縁に使い（写真の色とぶつからないように）、右下にオンライン（緑）／オフライン（灰）の印を出す */
export function Avatar({ person, size = 40, presence = true }: {
  person: (Pick<Person, "fullName" | "dept"> & { avatarUrl?: string; online?: boolean }) | null;
  size?: number;
  presence?: boolean;
}) {
  const ring = person ? DEPT_COLOR[person.dept] : "#B9B2A6";
  const dot = Math.max(8, Math.round(size * 0.28));
  const showDot = presence && person?.online !== undefined;
  return (
    <span className="av-wrap" style={{ width: size, height: size }}>
      <span
        className="av"
        aria-hidden
        style={{ ["--ring" as string]: ring, width: size, height: size, fontSize: Math.round(size * 0.38), borderWidth: size < 28 ? 2 : 3 }}
      >
        {person?.avatarUrl ? <img src={person.avatarUrl} alt="" className="av-img" /> : person?.fullName ? person.fullName.slice(0, 1) : "？"}
      </span>
      {showDot && <i className={`presence ${person!.online ? "on" : "off"}`} style={{ width: dot, height: dot }} role="img" aria-label={person!.online ? "オンライン" : "オフライン"} />}
    </span>
  );
}
/** 分野（お客様対応・安全など）の色つきラベル。声マップの円グラフの色と同じ */
export function FieldChip({ category }: { category: string }) {
  const f = fieldOf(category);
  return <span className="field-chip" style={{ ["--fc" as string]: f.color }}>{f.label}</span>;
}

export function DeptDot({ dept }: { dept: Dept }) {
  return <i className="dot" style={{ background: DEPT_COLOR[dept] }} title={DEPT_LABEL[dept]} />;
}

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className={`sw ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-label="読み込んでいます">
      <div className="skeleton" style={{ height: 96 }} />
      <div className="skeleton" style={{ height: 64 }} />
      <div className="skeleton" style={{ height: 64, width: "82%" }} />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="error">{error instanceof Error ? error.message : String(error)}</div>;
}
