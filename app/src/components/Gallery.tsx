import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";
import { AuthImage } from "./AuthImage";

const INTERVAL_MS = 3600;

/** ホームのギャラリー。投稿された写真を、少しずつ横にスライドして順に見せる（指で横にスワイプもできる） */
export function Gallery() {
  const { people, dataVersion, startPost } = useApp();
  const q = useAsync(() => api.gallery(), [dataVersion]);
  const track = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const items = q.data ?? [];

  useEffect(() => {
    if (items.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // 動きが苦手な人には自動で動かさない
    const t = setInterval(() => {
      const el = track.current;
      if (!el || paused.current || document.hidden) return;
      const first = el.firstElementChild as HTMLElement | null;
      if (!first) return;
      const step = first.offsetWidth + 10;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step, behavior: "smooth" });
    }, INTERVAL_MS);
    return () => clearInterval(t);
  }, [items.length]);

  if (q.loading && !q.data) return null;

  return (
    <>
      <div className="sec-head">
        <div className="sec-title">ギャラリー<span className="sec-sub">みんなの写真</span></div>
        <button type="button" className="text-btn" onClick={startPost}>＋ 写真を追加</button>
      </div>
      {items.length === 0 ? (
        <div className="panel gallery-empty">
          <img src={`${import.meta.env.BASE_URL}mascot/chaunee.png`} alt="" width={64} height={64} />
          <div>
            <b>まだ写真がありません</b>
            <p className="muted">「ひとこと」に写真をつけて投稿すると、ここに流れます。</p>
          </div>
        </div>
      ) : (
        <div
          className="gallery" ref={track} role="region" aria-label="写真のスライドショー" tabIndex={0}
          onPointerEnter={() => { paused.current = true; }} onPointerLeave={() => { paused.current = false; }}
          onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}
          onTouchStart={() => { paused.current = true; }} onTouchEnd={() => { setTimeout(() => { paused.current = false; }, 4000); }}
        >
          {items.map((g) => {
            const author = g.authorId ? people.get(g.authorId) : undefined;
            return (
              <figure className="g-item" key={g.id}>
                <AuthImage src={g.url} alt={g.caption} />
                <figcaption>
                  <span>{g.caption.length > 34 ? `${g.caption.slice(0, 34)}…` : g.caption}</span>
                  {author && <small>{author.fullName}</small>}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </>
  );
}
