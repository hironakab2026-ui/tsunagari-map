# つながりマップ（Teams アプリ）

トヨタユナイテッド社内コミュニケーションアプリの実装です。
要件定義書「つながりマップ_要件定義書.docx」（TU-DX-REQ-001）の機能 F-01〜F-18 に対応します。

- 座席：グループ席／プライベート席の座席構成を拠点ごとに編集可能、個人が好きなタイミングで引ける座席抽選、QR着席、座席マップ、得意分野での検索
- ホーム：支店を選んで抽選、共有タスク（全体へのアナウンス。広報が作成、完了は各自）、TUNニュース（公式の動画）、ギャラリー（投稿された写真のスライドショー）、トピックス（アナウンス・公式・所属支店のニュース）
- 名刺：デジタル名刺（表示名は本名。氏名は本人が編集可、呼ばれたい名前は自己紹介の一項目）、初回ログイン時の入力案内、公開範囲の設定、オンライン／オフライン表示（緑／灰）
- チャット：アプリ内の1対1チャット（Teams のチャットを開く導線も残す）
- 声：ひとこと投稿、要改善事項（これから直したいこと。支店選択・自動振り分け・進捗公開・匿名）、業務改善報告（すでに改善した事例。会社の「改善報告書」の項目で入力し、Word（.docx）の報告書として保存できる）、公式ニュース（広報担当による動画付き投稿）
- 声マップ：要改善事項・業務改善報告を拠点ごとに可視化。円の大きさ＝声の数、円グラフの色＝分野（お客様対応・業務の効率化・設備・環境・安全・品質・整備・その他）、点線＝一緒に取り組んだ人がいる拠点どうしのつながり

## 構成

```
tsunagari-map/
├─ shared/   抽選・振り分け・個人情報チェックなどの共通ロジック（テスト付き）
├─ app/      画面（React + TypeScript + Vite）。Teams のタブとして表示
├─ api/      サーバー（Azure Functions）。認証、SharePoint への保存、Teams 通知
├─ teams/    Teams アプリのマニフェストとアイコン
├─ infra/    Azure リソースの構築コード（Bicep）
├─ scripts/  SharePoint リストの作成、Teams アプリ zip の作成
└─ docs/     本番運用の構築手順（DEPLOYMENT.md）
```

データの流れは次のとおりです。

```
Teams（PC・スマホ） → app（静的サイト） → api（Azure Functions） → Microsoft Graph → SharePoint リスト
                         └ Teams SSO のトークン ┘                     └ Teams 通知
```

利用者の端末から SharePoint を直接操作しない構成にしています。
匿名投稿の匿名性を守り、権限のない人がデータを書き換えられないようにするためです。

## 1. まず手元で動かす（Microsoft 365 は不要）

必要なもの：Node.js 20 以上

```bash
npm install
npm test          # 共通ロジックとサーバーのテスト（19件）
npm run dev       # http://localhost:53000 を開く
```

`app/.env` の `VITE_USE_MOCK=true` のとき、架空データで全画面を操作できます（フロントエンドだけで完結し、サーバーは起動しません）。
データはブラウザを再読み込みすると初期状態に戻ります。

### サーバーも含めて、本物のデータベースで動かす場合（Microsoft 365 は不要）

「本当にデータが保存されているか確かめたい」ときは、こちらを使います。SharePoint の代わりに、PCの中に実ファイルとして残る
SQLite データベース（`api/.data/tsunagari.db`）を使うので、**Microsoft 365 のアカウントが無くても、手元のPCではサーバーを再起動してもデータは消えません**（Azure に置いた場合は消えます。`docs/DEPLOYMENT.md` 参照）。

[Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) をインストールしてから、次を実行します。

```bash
npm install -g azure-functions-core-tools@4   # 初回のみ
cp api/local.settings.sample.json api/local.settings.json
# api/local.settings.json の STORE を "sqlite" に変更する（AUTH_DISABLED は "true" のまま）
npm run build:shared && npm run build -w api
cd api && func start              # http://localhost:7071/api
```

別のターミナルで、`app/.env` の `VITE_USE_MOCK` を `false` に変えてから `npm run dev` を実行すると、
ブラウザの画面が実際にこの api サーバー・SQLiteデータベースと通信します（`vite.config.ts` の `/api` プロキシ経由）。

確かめ方の例:
1. ホーム画面で「抽選する」を押す → 座席が決まる
2. `func start` を実行しているターミナルを一度 Ctrl+C で止めて、もう一度 `func start` する
3. ブラウザを再読み込みしても、さっき決まった座席がそのまま残っている（= 本当にファイルに保存されている証拠）

`api/.data/` は `.gitignore` 済みなので、リポジトリには含まれません。中身を空にしたいときはこのフォルダを削除するだけです。
本番運用では `STORE=sharepoint`（SharePoint リスト）を使います。`sqlite` はローカル確認専用です。

`api/local.settings.json` が `STORE=memory`、`AUTH_DISABLED=true` の場合は、メモリ上のデータで動きます（再起動すると消えます）。

## 2. Microsoft 365 / Azure につなぐ（情報システム担当の作業）

Entra ID へのアプリ登録、SharePoint の準備、Azure リソースの作成（`infra/main.bicep`）、GitHub Actions による自動デプロイ、Teams への登録までの手順は
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** にまとめています。

一度接続すると、以後は `main` ブランチに push するだけで GitHub Actions が自動的にビルド・テスト・デプロイを行います。
座席の構成（グループ席／プライベート席の数・定員）や座席管理者の任命は、コード変更なしにアプリ内の「座席の設定」画面から随時変更できます。

## 3. 座席の抽選ロジック

`shared/src/lottery.ts` の `drawSeat()` にあります。バッチで全員分を一括抽選する方式ではなく、
出社した人がホーム画面の「抽選する」ボタンを押した時点で、その人だけを対象に席を割り当てます（出社時刻が一律でないため）。

- グループ席（円形、定員は拠点ごとに設定可能）に空きがあれば、グループ席から優先して選ぶ
- 候補が複数あれば、その中からランダムに1つ選ぶ
- 退席するといつでも席が空席に戻り、再度抽選できる
- 座席の種類（集中席・配慮の固定席など）は抽選対象から外れ、QRコード・手入力での着席のみとなる

座席の構成（グループ席の定員・数、プライベート席の数）は、座席管理者がアプリ内「座席の設定」画面から拠点ごとに編集します。

## 4. 未実装・今後の作業

- [ ] 出社予定の取り込み（Outlook 予定表または出社登録）。現在は拠点所属の全員が抽選対象
- [ ] 社員データの自動同期（Entra ID / 人事データ → People）
- [ ] 改善の声の督促通知（`kaizenReminder` は件数をログに出すまで）
- [ ] KPI ダッシュボード（Power BI から SharePoint リストを参照）
- [ ] 利用者が多くなった場合の保存先の移行（SharePoint → Dataverse または Azure SQL）。`api/src/lib/store.ts` の `DocStore` を実装し直すだけで移行できる構成
- [ ] 画面のアクセシビリティ確認とスマートフォン実機での操作テスト
- [ ] 公式ニュースの動画は現状リンク入力のみ。SharePoint/Streamへの直接アップロード導線は未実装

## 注意

- 同梱の人物・拠点・投稿はすべて架空です。
- 着席記録と投稿内容を人事評価に使わないことを、運用開始前に規程で定めてください（要件定義書 11章・14章）。
