// つながりマップ の Azure リソースを作成する。
//
// 【本番／会社のテナントに接続する場合】情報システム担当が実行:
//   az login
//   az group create -n rg-tsunagari-map -l japaneast
//   az deployment group create -g rg-tsunagari-map -f infra/main.bicep \
//     -p tenantId=<テナントID> apiClientId=<Entra アプリのクライアントID> \
//        apiAudience=api://<appのドメイン>/<クライアントID> spSiteId=<SharePointサイトID> \
//        graphClientSecret=<クライアントシークレット>
//
// 【個人のAzureアカウントで、まず動く姿を公開してみる場合】会社のMicrosoft 365は不要:
//   az deployment group create -g rg-tsunagari-map -f infra/main.bicep \
//     -p storeKind=sqlite authDisabled=true nodeVersion=22
//   （この場合 tenantId 等は空のままでよい。認証なし・SQLiteファイル保存で動く簡易公開版になる）
//
// 作成されるもの: Function App（api）＋ Storage ＋ Application Insights、Static Web App（app）。
// 詳しい手順は docs/DEPLOYMENT.md を参照してください。

@description('リソース名の接頭辞')
param appName string = 'tsunagari-map'

@description('デプロイ先リージョン')
param location string = resourceGroup().location

@description('保存先。会社のSharePointに接続するなら "sharepoint"、個人アカウントでの簡易公開なら "sqlite"')
@allowed(['sharepoint', 'sqlite'])
param storeKind string = 'sharepoint'

@description('Teams SSO によるサインインを求めるか。個人アカウントでの簡易公開では true（認証なし）にすることが多い')
param authDisabled bool = false

@description('Function App の Node.js バージョン。storeKind=sqlite（node:sqlite を使う）なら 22 以上が必要')
param nodeVersion string = '20'

@description('Microsoft Entra テナントID（storeKind=sharepoint のときのみ必要）')
param tenantId string = ''

@description('API 用に登録した Entra アプリのクライアントID（storeKind=sharepoint のときのみ必要）')
param apiClientId string = ''

@description('API のアプリケーションID URI（storeKind=sharepoint のときのみ必要）')
param apiAudience string = ''

@description('SharePoint サイトID（storeKind=sharepoint のときのみ必要）')
param spSiteId string = ''

@description('Teams アプリのID（teams/.env.teams の TEAMS_APP_ID と同じ値。任意）')
param teamsAppId string = ''

@description('Microsoft Graph 呼び出し用のクライアントシークレット（storeKind=sharepoint のときのみ必要）。本番ではデプロイ後にマネージドID方式へ移行することを推奨')
@secure()
param graphClientSecret string = ''

@description('簡易公開（AUTH_DISABLED=true）のときに使う開発用ユーザーID・ロール')
param devUserId string = 'demo'
param devUserRoles string = 'SeatManager,PR,KaizenOwner'

@description('app（フロントエンド）からの CORS を許可するオリジン。空の場合は Static Web App のURLをデプロイ後に手動設定してください')
param corsOrigin string = ''

@description('改善の声の督促日数')
param kaizenRemindDays string = '5'

var storageAccountName = toLower(replace('${appName}fnstore', '-', ''))
var storageAccountNameTrimmed = length(storageAccountName) > 24 ? substring(storageAccountName, 0, 24) : storageAccountName
var functionAppName = '${appName}-api'
var planName = '${appName}-plan'
var appInsightsName = '${appName}-insights'
var staticWebAppName = '${appName}-app'
// Linux Consumption プランでは /home が Azure Files 上に永続化される。storeKind=sqlite のとき、
// SQLite ファイルをここに置くことで、再起動やスケールアウトをまたいでもデータが残る
// （同時書き込みが多い高負荷用途には向かない。会社導入時は storeKind=sharepoint を使う）
var sqliteDbPath = '/home/data/tsunagari.db'
var sqlitePhotoDir = '/home/data/photos'

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountNameTrimmed
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: planName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|${nodeVersion}'
      cors: {
        allowedOrigins: empty(corsOrigin) ? [] : [corsOrigin]
      }
      appSettings: concat([
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~${nodeVersion}' }
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'STORE', value: storeKind }
        { name: 'AUTH_DISABLED', value: string(authDisabled) }
        { name: 'DEV_USER_ID', value: devUserId }
        { name: 'DEV_USER_ROLES', value: devUserRoles }
        { name: 'TENANT_ID', value: tenantId }
        { name: 'API_CLIENT_ID', value: apiClientId }
        { name: 'API_AUDIENCE', value: apiAudience }
        { name: 'GRAPH_CLIENT_SECRET', value: graphClientSecret }
        { name: 'SP_SITE_ID', value: spSiteId }
        { name: 'TEAMS_APP_ID', value: teamsAppId }
        { name: 'APP_TIMEZONE', value: 'Asia/Tokyo' }
        { name: 'KAIZEN_REMIND_DAYS', value: kaizenRemindDays }
      ], storeKind == 'sqlite' ? [
        { name: 'SQLITE_DB_PATH', value: sqliteDbPath }
        { name: 'SQLITE_PHOTO_DIR', value: sqlitePhotoDir }
      ] : [])
    }
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    provider: 'GitHub'
  }
}

output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output functionAppPrincipalId string = functionApp.identity.principalId
output staticWebAppName string = staticWebApp.name
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output storageAccountName string = storage.name
