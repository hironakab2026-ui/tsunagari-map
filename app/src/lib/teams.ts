import { app, authentication, barCode } from "@microsoft/teams-js";

export interface HostInfo {
  inTeams: boolean;
  userObjectId?: string;
  isMobile: boolean;
}

let host: HostInfo = { inTeams: false, isMobile: false };

/** Teams 内で開かれていれば初期化する。ブラウザ単体の場合はモック利用 */
export async function initHost(): Promise<HostInfo> {
  try {
    await Promise.race([
      app.initialize(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
    ]);
    const ctx = await app.getContext();
    const platform = ctx.app.host.clientType;
    host = {
      inTeams: true,
      userObjectId: ctx.user?.id,
      isMobile: platform === "android" || platform === "ios" || platform === "ipados",
    };
    app.notifySuccess();
  } catch {
    host = { inTeams: false, isMobile: /iPhone|Android/.test(navigator.userAgent) };
  }
  return host;
}

export const getHost = () => host;

/** Teams SSO トークン。api 側でトークン検証し、Graph へは api から接続する */
export async function getSsoToken(): Promise<string | null> {
  if (!host.inTeams) return null;
  return authentication.getAuthToken();
}

/** 机のQRコード読み取り。Teams モバイルではネイティブのスキャナを使う */
export async function scanSeatQr(): Promise<string | null> {
  if (host.inTeams && barCode.isSupported()) {
    return barCode.scanBarCode({ timeOutIntervalInSec: 30 });
  }
  return null; // 未対応環境では手入力にフォールバック
}

export async function openTeamsChat(userPrincipalName: string, message?: string) {
  const url = `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(userPrincipalName)}${
    message ? `&message=${encodeURIComponent(message)}` : ""
  }`;
  if (host.inTeams) await app.openLink(url);
  else window.open(url, "_blank");
}
