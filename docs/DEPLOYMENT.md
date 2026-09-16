# 本番運用の構築手順（情報システム担当向け）

このドキュメントは、つながりマップを実際の Microsoft 365 テナントと Azure サブスクリプションにつないで、
Teams 上で公開・運用するための手順です。コード側の準備（座席の種類・権限・座席抽選など）は完了しており、
ここから先は Microsoft 365 / Azure の管理者権限がある方の作業です。

全体の流れ：

```
① Entra ID にアプリを登録
② SharePoint サイトとリストを準備
③ Azure リソースを作成（infra/main.bicep）
④ GitHub Actions の Secrets を設定 → push すると自動デプロイ
⑤ Teams にアプリを登録・公開
```

一度この設定が終われば、以後はコードを直して `main` ブランチに push するだけで、
GitHub Actions が自動的にビルド・テスト・デプロイを行います（随時編集・公開が可能な状態になります）。

## 個人のAzureアカウントで、まず「オンラインで見える形」を公開する場合

会社の Microsoft 365 に接続する前に、まず動いている姿をオンラインで共有したいだけなら、この節だけで完結します。
①②（Entra ID・SharePoint）は不要です。認証なし（誰でもURLを知っていれば開ける）・SQLiteファイル保存の簡易版になります。

1. [Azure Portal](https://portal.azure.com) で、お持ちの**個人の**Microsoftアカウント（職場アカウントとは別。Gmailでも新規登録できます）でサインインし、無料プランを開始します（クレジットカード確認あり、これは本人が行う必要があります）。
2. `az login` でサインインします（このリポジトリでは Claude Code から `az login --use-device-code` で行い、表示されたコードをブラウザで入力する形で進めました）。
3. リソースグループを作り、簡易版としてデプロイします。

```bash
az group create -n rg-tsunagari-map -l japaneast
az deployment group create -g rg-tsunagari-map -f infra/main.bicep \
  -p storeKind=sqlite authDisabled=true nodeVersion=22
```

4. 出力される `staticWebAppUrl` と `functionAppUrl` を控えます。GitHub Actions の Secrets（`AZURE_STATIC_WEB_APPS_API_TOKEN` 等）を設定すれば、以後 `main` への push で自動的にこのURLへ反映されます（4章を参照）。
5. `VITE_API_BASE` には `https://<functionAppName>.azurewebsites.net/api` を設定します。

この構成の制約：

- 認証なし（`AUTH_DISABLED=true`）なので、URLを知っている人は誰でも開けます。社外秘の情報は入れないでください。
- SQLiteファイルは Function App の永続領域（`/home`）に置かれ、通常の再起動では消えませんが、アクセスが増えて複数インスタンスに自動スケールした場合の同時書き込みには強くありません。あくまで少人数での確認・共有用です。
- 本当に会社で運用するときは、下の「① Entra ID にアプリを登録」以降の手順で `storeKind=sharepoint` に切り替えてください。

## ① Entra ID にアプリを登録

1. [Entra 管理センター](https://entra.microsoft.com/) →「アプリの登録」→ 新規登録。
2. 「API の公開」で、アプリケーション ID URI を `api://<Static Web Appsのドメイン>/<クライアントID>` にします（後で Static Web Apps のURLが決まってから確定で構いません。仮でも先に進められます）。スコープ `access_as_user` を追加します。
3. 同じ画面で「承認済みクライアント アプリケーション」に、Teams のクライアントを追加します。
   - `1fec8e78-bce4-4aaf-ab1b-5451cc387264`（Teams デスクトップ・モバイル）
   - `5e3ce6c0-2b1f-4285-8d4b-75ee78787346`（Teams Web）
4. 「アプリ ロール」に次の4つを作成します。
   - `SeatManager`：座席管理の初期設定・座席管理者の任命
   - `PR`：社内ニュース採用・公式ニュースの投稿
   - `KaizenOwner`：改善の声の担当
   - `Admin`：管理者（すべての操作が可能）
   その後「エンタープライズ アプリケーション」からこのアプリを開き、「ユーザーとグループ」で担当者にロールを割り当てます。
   - 支社ごとの座席編集権限（誰がどの支社の座席を編集できるか）は、アプリ内の「座席の設定」画面から `SeatManager`/`Admin` の人が個別に付与します。Entra 側の作業は不要です。
5. 「API のアクセス許可」で、次の **Microsoft Graph のアプリケーション許可** を追加し、管理者の同意を与えます。
   - `Sites.Selected`（後述の SharePoint サイトに write 権限を付与）
   - `TeamsActivity.Send`
6. 「証明書とシークレット」でクライアントシークレットを作成し、値を控えます（Azure リソース作成時に使用）。本番では Azure のマネージド ID への移行を推奨します（`GRAPH_CLIENT_SECRET` の代わりにシステム割り当てマネージド ID を Graph 権限に紐付ける）。

> Teams SSO の詳しい設定手順は Microsoft の最新ドキュメントを確認してください。画面名は変わることがあります。

## ② SharePoint を準備

1. アプリ専用の SharePoint サイトを作成します。
2. サイトIDを確認します（Graph エクスプローラーで `GET /sites/<ホスト名>:/sites/<サイト名>` を実行）。
3. リストを作成します。

```bash
npm install
npm run build:shared
TENANT_ID=... API_CLIENT_ID=... GRAPH_CLIENT_SECRET=... SP_SITE_ID=... \
  node scripts/provision-sharepoint.mjs --seed
```

`--seed` を付けると架空データが入ります。実データ登録後に削除してください。

4. `AnonymousAudit` リストは、アクセス許可の継承を中止し、管理者だけが閲覧できるようにします。
5. `Branches`・`Seats`・`People` に、実際の拠点・座席構成・社員データを登録します。
   - 座席の構成（グループ席／プライベート席の数・グループ席の定員）は、Azure 接続後はアプリの「座席の設定」画面から座席管理者が編集できます。ここで登録するのは初期値で構いません。

## ③ Azure リソースを作成

Azure CLI と Bicep が必要です（`az bicep install`）。

```bash
az login
az group create -n rg-tsunagari-map -l japaneast
az deployment group create -g rg-tsunagari-map -f infra/main.bicep \
  -p tenantId=<テナントID> \
     apiClientId=<① で作成したアプリのクライアントID> \
     apiAudience=api://<②のあとで決まるドメイン>/<クライアントID> \
     spSiteId=<② のサイトID> \
     graphClientSecret=<① で作成したシークレット>
```

デプロイ結果の出力（`functionAppUrl`、`staticWebAppUrl`、`functionAppName`、`staticWebAppName`）を控えます。
`staticWebAppUrl` が決まったら、① の「アプリケーション ID URI」と Teams マニフェストの `APP_DOMAIN` をこの値に更新してください。

作成されるリソース：Azure Static Web Apps（app）、Azure Functions（api、Node.js 20）、Storage Account、Application Insights。

## ④ GitHub Actions で自動デプロイ

このリポジトリの GitHub の **Settings → Secrets and variables → Actions** で、以下を登録します。

| Secret 名 | 値 |
|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Azure Portal の Static Web Apps リソース →「管理用トークン」 |
| `AZURE_FUNCTIONAPP_NAME` | ③ の出力 `functionAppName` |
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | Azure Portal の Function App リソース →「発行プロファイルの取得」でダウンロードした XML の中身 |
| `VITE_API_BASE` | 例：`https://<functionAppName>.azurewebsites.net/api` |

登録が済むと、`main` ブランチへの push で `.github/workflows/deploy.yml` が自動的に app と api をデプロイします（未設定の間はそのジョブがスキップされ、CI は失敗しません）。

Function App 側のアプリ設定（`STORE=sharepoint`、`AUTH_DISABLED=false` など）は ③ の Bicep で設定済みです。CORS には app の URL（`staticWebAppUrl`）を Azure Portal から追加してください（`infra/main.bicep` の `corsOrigin` パラメータで最初から指定することもできます）。

## ⑤ Teams に登録

```bash
node scripts/package-teams-app.mjs   # 初回は teams/.env.teams が作られるので値を書き換える
node scripts/package-teams-app.mjs   # teams/build/tsunagari-map.zip ができる
```

`teams/.env.teams` に設定する値：

```
TEAMS_APP_ID=<新しく発行するGUID。既にある場合はその値>
APP_DOMAIN=<③ の staticWebAppUrl のホスト名>
API_DOMAIN=<③ の functionAppUrl のホスト名>
API_CLIENT_ID=<① のクライアントID>
```

Teams 管理センターの「アプリを管理」から `teams/build/tsunagari-map.zip` をアップロードし、試行拠点のメンバーに公開します。
全社への一斉インストールは「セットアップ ポリシー」で行います。

## 運用開始後：随時編集・訂正・公開の流れ

1. コードを変更する（ローカルまたは Claude Code から）。
2. `npm test` と `npm run typecheck` を通す。
3. `main` ブランチに push（または Pull Request をマージ）。
4. GitHub Actions が自動的にビルド・テストし、app（Static Web Apps）と api（Functions）へデプロイする。
5. 数分でアプリに反映される（Teams タブは通常キャッシュなしで最新版が表示されます）。

座席の構成（グループ席／プライベート席の数・定員）や座席管理者の任命は、コード変更なしにアプリ内の「座席の設定」画面から随時変更できます。

## 注意

- 同梱の人物・拠点・投稿はすべて架空です。
- 着席記録と投稿内容を人事評価に使わないことを、運用開始前に規程で定めてください（要件定義書 11章・14章）。
- `GRAPH_CLIENT_SECRET` は有効期限があります。期限切れ前に更新するか、マネージド ID 方式への移行を検討してください。
