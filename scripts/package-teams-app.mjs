// teams/manifest.json の {{変数}} を .env.teams の値で置き換え、Teams にアップロードする zip を作る
// 使い方: node scripts/package-teams-app.mjs  → teams/build/tsunagari-map.zip
// Windows・macOS・Linux・GitHub Actions のいずれでも動くよう、シェルコマンドではなく Node 標準機能だけで zip を作る
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { writeZip } from "./lib/zip.mjs";

const envPath = "teams/.env.teams";
if (!existsSync(envPath)) {
  writeFileSync(envPath, `TEAMS_APP_ID=${randomUUID()}\nAPP_DOMAIN=tsunagari.example.azurestaticapps.net\nAPI_DOMAIN=tsunagari-api.azurewebsites.net\nAPI_CLIENT_ID=00000000-0000-0000-0000-000000000000\n`);
  console.log(`${envPath} を作成しました。値を実際のものに書き換えてから、もう一度実行してください。`);
  process.exit(0);
}
const env = Object.fromEntries(readFileSync(envPath, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split("=").map((x) => x.trim())));
let manifest = readFileSync("teams/manifest.json", "utf8");
manifest = manifest.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!env[k]) throw new Error(`${envPath} に ${k} がありません`);
  return env[k];
});
mkdirSync("teams/build", { recursive: true });
writeFileSync("teams/build/manifest.json", manifest);
copyFileSync("teams/color.png", "teams/build/color.png");
copyFileSync("teams/outline.png", "teams/build/outline.png");

const zipPath = "teams/build/tsunagari-map.zip";
writeZip(zipPath, [
  { name: "manifest.json", data: Buffer.from(manifest, "utf8") },
  { name: "color.png", data: readFileSync("teams/color.png") },
  { name: "outline.png", data: readFileSync("teams/outline.png") },
]);
console.log(`${zipPath} を作成しました`);
