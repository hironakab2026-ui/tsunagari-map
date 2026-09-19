import { useEffect, useState } from "react";
import { getSsoToken } from "../lib/teams";

/** 認証が必要な写真を表示する。img タグはトークンを送れないため、取得して blob URL にする */
export function AuthImage({ src, alt }: { src: string; alt: string }) {
  const direct = !src.startsWith("/api/"); // data URL・同梱の静的画像・外部リンクは、そのまま表示できる
  const [url, setUrl] = useState<string | null>(direct ? src : null);
  useEffect(() => {
    if (direct) { setUrl(src); return; }
    let revoked: string | null = null;
    (async () => {
      const token = await getSsoToken();
      const base = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/api$/, "");
      const res = await fetch(base + src, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) return;
      revoked = URL.createObjectURL(await res.blob());
      setUrl(revoked);
    })();
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [src, direct]);
  return url ? <img src={url} alt={alt} /> : null;
}
