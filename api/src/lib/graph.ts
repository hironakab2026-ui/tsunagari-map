import { ClientSecretCredential, DefaultAzureCredential, type TokenCredential } from "@azure/identity";

let credential: TokenCredential | null = null;

function getCredential(): TokenCredential {
  if (credential) return credential;
  const { TENANT_ID, API_CLIENT_ID, GRAPH_CLIENT_SECRET } = process.env;
  credential = GRAPH_CLIENT_SECRET
    ? new ClientSecretCredential(TENANT_ID!, API_CLIENT_ID!, GRAPH_CLIENT_SECRET)
    : new DefaultAzureCredential(); // Azure 上ではマネージドIDを使う
  return credential;
}

/** アプリ権限で Microsoft Graph を呼ぶ。429/503 は待って再試行する */
export async function graph<T = unknown>(path: string, init: RequestInit = {}, retries = 3): Promise<T> {
  const token = await getCredential().getToken("https://graph.microsoft.com/.default");
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token!.token}`,
      ...(init.body && !(init.body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if ((res.status === 429 || res.status === 503) && retries > 0) {
    const wait = Number(res.headers.get("Retry-After") ?? "2") * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return graph<T>(path, init, retries - 1);
  }
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.arrayBuffer()) as Promise<T>;
}
