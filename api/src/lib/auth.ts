import { createRemoteJWKSet, jwtVerify } from "jose";
import type { HttpRequest } from "@azure/functions";

export type Role = "SeatManager" | "PR" | "KaizenOwner" | "Admin";

export interface User {
  id: string;        // Entra オブジェクトID（oid）
  email: string;
  name: string;
  roles: Role[];
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Teams SSO で取得したトークンを検証する。アプリロールは Entra の「アプリ ロール」で割り当てる */
export async function authenticate(req: HttpRequest): Promise<User> {
  if (process.env.AUTH_DISABLED === "true") {
    return {
      id: process.env.DEV_USER_ID ?? "u05",
      email: "dev@example.co.jp",
      name: "開発ユーザー",
      roles: (process.env.DEV_USER_ROLES ?? "").split(",").filter(Boolean) as Role[],
    };
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "サインインが必要です");

  const tenant = process.env.TENANT_ID!;
  jwks ??= createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`));
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      audience: [process.env.API_AUDIENCE!, process.env.API_CLIENT_ID!],
    });
    return {
      id: String(payload.oid),
      email: String(payload.preferred_username ?? ""),
      name: String(payload.name ?? ""),
      roles: (payload.roles as Role[] | undefined) ?? [],
    };
  } catch {
    throw new HttpError(401, "サインイン情報を確認できませんでした。Teams を再読み込みしてください");
  }
}

export function requireRole(user: User, ...roles: Role[]) {
  if (user.roles.includes("Admin") || roles.some((r) => user.roles.includes(r))) return;
  throw new HttpError(403, "この操作を行う権限がありません");
}
