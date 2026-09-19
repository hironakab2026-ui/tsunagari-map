// SharePoint サイトに、アプリが使うリストと写真用フォルダを作成する
// 使い方:
//   TENANT_ID=... API_CLIENT_ID=... GRAPH_CLIENT_SECRET=... SP_SITE_ID=... node scripts/provision-sharepoint.mjs [--seed]
//   --seed を付けると、試行用の架空データ（拠点・座席・人）を投入する
// 必要な権限: Sites.Selected（対象サイトに manage 権限を付与）または Sites.Manage.All
import { ClientSecretCredential } from "@azure/identity";

const { TENANT_ID, API_CLIENT_ID, GRAPH_CLIENT_SECRET, SP_SITE_ID } = process.env;
if (!TENANT_ID || !API_CLIENT_ID || !GRAPH_CLIENT_SECRET || !SP_SITE_ID) {
  console.error("TENANT_ID, API_CLIENT_ID, GRAPH_CLIENT_SECRET, SP_SITE_ID を設定してください");
  process.exit(1);
}
const LISTS = ["People", "Branches", "Seats", "Assignments", "Posts", "Reactions", "AnonymousAudit", "RoutingRules"];

const cred = new ClientSecretCredential(TENANT_ID, API_CLIENT_ID, GRAPH_CLIENT_SECRET);
async function graph(path, init = {}) {
  const { token } = await cred.getToken("https://graph.microsoft.com/.default");
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const existing = await graph(`/sites/${SP_SITE_ID}/lists?$select=displayName&$top=200`);
const names = new Set(existing.value.map((l) => l.displayName));
for (const name of LISTS) {
  if (names.has(name)) { console.log(`- ${name}: 作成済み`); continue; }
  await graph(`/sites/${SP_SITE_ID}/lists`, {
    method: "POST",
    body: JSON.stringify({
      displayName: name,
      list: { template: "genericList" },
      columns: [
        { name: "DocId", text: {}, indexed: true, enforceUniqueValues: true },
        { name: "PartitionKey", text: {}, indexed: true },
        { name: "Data", text: { allowMultipleLines: true } },
      ],
    }),
  });
  console.log(`+ ${name}: 作成しました`);
}
console.log("\n重要: AnonymousAudit リストは SharePoint の「アクセス許可の継承を中止」し、管理者だけが閲覧できるようにしてください。");
console.log("他のリストも、利用者が直接編集できないよう閲覧権限のみ（またはアクセスなし）にすることを推奨します。");

if (process.argv.includes("--seed")) {
  const { SEED_BRANCHES, SEED_PEOPLE, SEED_SEATS, DEFAULT_ROUTING_RULES } = await import("../shared/dist/index.js");
  const lists = await graph(`/sites/${SP_SITE_ID}/lists?$select=id,displayName&$top=200`);
  const id = Object.fromEntries(lists.value.map((l) => [l.displayName, l.id]));
  const put = (list, docId, pk, data) => graph(`/sites/${SP_SITE_ID}/lists/${id[list]}/items`, {
    method: "POST", body: JSON.stringify({ fields: { Title: docId, DocId: docId, PartitionKey: pk, Data: JSON.stringify(data) } }),
  });
  for (const b of SEED_BRANCHES) await put("Branches", b.id, "all", b);
  for (const s of SEED_SEATS) await put("Seats", s.id, s.branchId, s);
  for (const p of SEED_PEOPLE) await put("People", p.id, p.branchId, p);
  for (const r of DEFAULT_ROUTING_RULES) await put("RoutingRules", r.department, "all", r);
  console.log("試行用データを投入しました（人物は架空。本番では Entra ID の実データに置き換えてください）");
}
