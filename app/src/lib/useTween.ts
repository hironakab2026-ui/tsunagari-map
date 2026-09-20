import { useEffect, useRef, useState } from "react";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * 数値の配列が変わったとき、前の値から新しい値へ滑らかに動かして返す（円の大きさや円グラフの割合用）。
 * 動きを減らす設定のときは、すぐに切り替える。
 */
export function useTween(target: number[], ms = 550): number[] {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const current = useRef(target);
  const key = target.join(",");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { current.current = target; setValue(target); return; }
    from.current = current.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const e = easeOut(p);
      // 長さが変わったときは、足りない分を0から始める
      const next = target.map((t, i) => (from.current[i] ?? 0) + (t - (from.current[i] ?? 0)) * e);
      current.current = next;
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // 画面が見えていない間はアニメーションが止まるので、遅れても必ず最終値になるようにしておく
    const done = setTimeout(() => { current.current = target; setValue(target); }, ms + 80);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);

  return value;
}