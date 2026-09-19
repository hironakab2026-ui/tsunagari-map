import { useEffect, useState } from "react";
import { getSsoToken } from "../lib/teams";

/** 動画を再生する。自社APIに置いた動画は認証が要るため、取得して blob URL にして渡す。外部の https リンクはそのまま再生する */
export function AuthVideo({ src, onError }: { src: string; onError?: () => void }) {
  const own = src.startsWith("/api/");
  const [url, setUrl] = useState<string | null>(own ? null : src);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (failed) onError?.(); }, [failed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!own) { setUrl(src); return; }
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const token = await getSsoToken();
        const base = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/api$/, "");
        const res = await fetch(base + src, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) throw new Error(String(res.status));
        const blobUrl = URL.createObjectURL(await res.blob());
        if (cancelled) { URL.revokeObjectURL(blobUrl); return; }
        revoked = blobUrl;
        setUrl(blobUrl);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [src, own]);
  if (failed) return <div className="muted">動画を読み込めませんでした。時間をおいて開き直してください。</div>;
  if (!url) return <div className="muted">動画を読み込んでいます…</div>;
  return <video className="post-video" src={url} controls playsInline preload="metadata" onError={() => setFailed(true)} />;
}
