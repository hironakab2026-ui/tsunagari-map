import { useEffect, useState } from "react";
import { getSsoToken } from "../lib/teams";

/** 認証が必要な写真を表示する。img タグはトークンを送れないため、取得して blob URL にする */
export function AuthImage({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(src.startsWith("data:") ? src : null);
  useEffect(() => {
    if (src.startsWith("data:")) return;
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
  }, [src]);
  return url ? <img src={url} alt={alt} /> : null;
}
