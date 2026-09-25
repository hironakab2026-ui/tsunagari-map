# Claude Code 向けメモ

- 仕様の正は要件定義書（TU-DX-REQ-001）。機能ID（F-xx）をコミットメッセージに含める。
- 業務ロジックは `api/src/lib/service.ts`、純粋なロジックは `shared/`。画面にロジックを書かない。
- 変更後は `npm test` と `npm run typecheck` を必ず通す。座席抽選ロジック（`shared/src/lottery.ts` の `drawSeat`）を変えたら `shared/src/lottery.test.ts` にテストを追加する。
- UI の文言は日本語。利用者の言葉で書き、敬語は「です・ます」。
- 個人情報：お客様情報を扱う機能は追加しない。匿名投稿の投稿者IDは `AnonymousAudit` 以外に保存しない。
- SharePoint はコレクションごとに `DocId`/`PartitionKey`/`Data`(JSON) の汎用スキーマ（`api/src/lib/store.ts`）。型定義（`shared/src/types.ts`）を変えても SharePoint 側のリスト列変更は不要。新しいコレクションを追加した場合のみ `api/src/lib/store.ts` の `COLLECTIONS` と `scripts/provision-sharepoint.mjs` の `LISTS` を更新する。
- `STORE=sqlite`（`api/src/lib/store.ts` の `SqliteStore`）は、Microsoft 365 アカウントなしでローカルに実データベースを確認するための開発用ストア。`node:sqlite`（Node.js 組み込み、実行時は `process.getBuiltinModule("node:sqlite")` 経由で読み込む。Vite/Vitest が新しい組み込みモジュールを解決できず静的 import だと失敗するため）。型は `api/src/lib/sqlite-node-types.d.ts` に自前定義している（`@types/node` は Node 20 系のため）。本番は `STORE=sharepoint` を使う。
- 声の種類は `kaizen`（要改善事項）と `report`（業務改善報告）。声マップの集計対象はこの2つだけ（ひとこと・公式は含めない）。分野は `shared/src/fields.ts` の `IMPROVEMENT_FIELDS`（色もここ）。つながり＝共同者が別拠点にいる声（部門は問わない）。
- 業務改善報告は、会社の「改善報告書」の項目（`Post.report`＝`ReportDetail`）で入力する。Word への書き出しは `shared/src/reportDoc.ts`（依存なしの zip 書き出し `zip.ts` を使い、ブラウザ内で作る。サーバーに送らない）。様式を変えるときは `buildReportBodyXml` を直し、`reportDoc.test.ts` を更新する。詳細のない古い投稿は、本文・効果から自動で埋める。
- 着席まわり（抽選・QR着席・退席・座席設定）は `Service.serialized` で1件ずつ処理し、書いた直後に定員を確かめる。座席マップに出さない設定の人も、空席の数・満席の判定には数える（`floor().counts`）。
- 表示名は本名（`fullName`）。`nickname`（呼ばれたい名前）は名刺の自己紹介欄だけに出し、座席表・投稿・チャットには使わない。
- オンライン表示：`Person.lastSeenAt`（アプリを開いている間の心拍）が5分以内、または今日着席中なら `online`（`shared/src/presence.ts`）。
- 共有タスクは `Tasks`、アプリ内チャットは `Messages` コレクション（チャットは会話内容が入るため、SharePoint ではアクセス権を管理者に限定すること）。
- `app/public/mascot/`・`app/public/gallery/` には、トヨタユナイテッドのマスコット（チャウピー・チャウニー）の画像を置いている。社外に公開するリポジトリ・サイトに載せる前に、利用許可を確認すること。
- 本番接続・Azure構築の手順は `docs/DEPLOYMENT.md`。実際のテナント操作はユーザー側で行う（Claude はスクリプト・IaCの整備までを行う）。
- `scripts/package-teams-app.mjs` は Windows でも動くよう、zip作成に外部ライブラリではなく `scripts/lib/zip.mjs`（依存なしの自前実装）を使っている。`archiver` 等のサードパーティ zip ライブラリは、この環境（OneDrive配下のパス）で Node のネイティブクラッシュを起こすことを確認済みなので使わない。
