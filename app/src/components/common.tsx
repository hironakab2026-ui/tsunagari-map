import { useEffect, type ReactNode } from "react";
import { DEPT_LABEL, type Dept, type Person } from "@tsunagari/shared";

export const DEPT_COLOR: Record<Dept, string> = {
  sales: "var(--sales)",
  eng: "var(--eng)",
  office: "var(--office)",
};

export function Avatar({ person, size = 40 }: { person: (Pick<Person, "nickname" | "dept"> & { avatarUrl?: string }) | null; size?: number }) {
  return (
    <div
      className="av"
      aria-hidden
      style={{
        background: person ? DEPT_COLOR[person.dept] : "#9AA2AD",
        width: size, height: size, fontSize: Math.round(size * 0.38), margin: 0,
      }}
    >
      {person?.avatarUrl ? <img src={person.avatarUrl} alt="" className="av-img" /> : person?.nickname ? person.nickname.slice(0, 1) : "？"}
    </div>
  );
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
  return <div className="loading">読み込んでいます</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="error">{error instanceof Error ? error.message : String(error)}</div>;
}
