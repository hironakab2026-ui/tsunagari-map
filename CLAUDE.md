# Claude Code 向けメモ

- 仕様の正は要件定義書（TU-DX-REQ-001）。機能ID（F-xx）をコミットメッセージに含める。
- 業務ロジックは `api/src/lib/service.ts`、純粋なロジックは `shared/`。画面にロジックを書かない。
- 変更後は `npm test` と `npm run typecheck` を必ず通す。座席抽選ロジック（`shared/src/lottery.ts` の `drawSeat`）を変えたら `shared/src/lottery.test.ts` にテストを追加する。
- UI の文言は日本語。利用者の言葉で書き、敬語は「です・ます」。
- 個人情報：お客様情報を扱う機能は追加しない。匿名投稿の投稿者IDは `AnonymousAudit` 以外に保存しない。
- SharePoint はコレクションごとに `DocId`/`PartitionKey`/`Data`(JSON) の汎用スキーマ（`api/src/lib/store.ts`）。型定義（`shared/src/types.ts`）を変えても SharePoint 側のリスト列変更は不要。新しいコレクションを追加した場合のみ `api/src/lib/store.ts` の `COLLECTIONS` と `scripts/provision-sharepoint.mjs` の `LISTS` を更新する。
- 本番接続・Azure構築の手順は `docs/DEPLOYMENT.md`。実際のテナント操作はユーザー側で行う（Claude はスクリプト・IaCの整備までを行う）。
- `scripts/package-teams-app.mjs` は Windows でも動くよう、zip作成に外部ライブラリではなく `scripts/lib/zip.mjs`（依存なしの自前実装）を使っている。`archiver` 等のサードパーティ zip ライブラリは、この環境（OneDrive配下のパス）で Node のネイティブクラッシュを起こすことを確認済みなので使わない。
