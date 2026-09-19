import { useState } from "react";
import type { Post } from "@tsunagari/shared";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";
import { AuthVideo } from "./AuthVideo";

const VIDEO_LINK = /\.(mp4|webm|mov)(\?.*)?$/i;
const playable = (p: Post) =>
  p.mediaType === "video" && !!p.mediaUrl && (p.mediaUrl.startsWith("/api/") || p.mediaUrl.startsWith("data:") || VIDEO_LINK.test(p.mediaUrl));

/** ホームの「TUNニュース」。公式から発信された動画を流す。動画がまだないときは、ロゴ画像を出す */
export function NewsPanel() {
  const { dataVersion, me } = useApp();
  const q = useAsync(() => api.posts("official"), [dataVersion]);
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const canPost = !!me.roles?.some((r) => r === "PR" || r === "Admin");
  const videos = (q.data ?? []).filter((p) => playable(p) && !broken.has(p.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const current = videos[Math.min(index, videos.length - 1)];

  return (
    <>
      <div className="sec-head"><div className="sec-title">TUNニュース<span className="sec-sub">公式からの動画</span></div></div>
      <div className="panel news">
        {current ? (
          <>
            <AuthVideo key={current.id} src={current.mediaUrl!} onError={() => setBroken((s) => new Set(s).add(current.id))} />
            <div className="news-caption"><b>{current.body.length > 60 ? `${current.body.slice(0, 60)}…` : current.body}</b>
              <span className="muted">{new Date(current.createdAt).toLocaleDateString("ja-JP")}</span>
            </div>
            {videos.length > 1 && (
              <div className="fchips news-list" role="group" aria-label="他のニュース">
                {videos.map((v, i) => (
                  <button key={v.id} type="button" className={i === Math.min(index, videos.length - 1) ? "on" : ""} onClick={() => setIndex(i)}>
                    {v.body.slice(0, 12)}{v.body.length > 12 ? "…" : ""}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="news-empty">
            <img src={`${import.meta.env.BASE_URL}tun-news-logo.svg`} alt="TUNニュース" />
            <div className="news-empty-text">
              <b>動画ニュースは準備中です</b>
              <span className="muted">{canPost ? "「声」の「公式」から動画を投稿すると、ここで流れます。" : "公式から動画が届くと、ここで流れます。"}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
