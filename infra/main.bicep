// つながりマップ の Azure リソースを作成する。
// 使い方（情報システム担当が Azure CLI で実行）:
//   az login
//   az group create -n rg-tsunagari-map -l japaneast
//   az deployment group create -g rg-tsunagari-map -f infra/main.bicep \
//     -p tenantId=<テナントID> apiClientId=<Entra アプリのクライアントID> \
//        apiAudience=api://<appのドメイン>/<クライアントID> spSiteId=<SharePointサイトID> \
//        graphClientSecret=<クライアントシークレット>
//
// 作成されるもの: Function App（api）＋ Storage ＋ Application Insights、Static Web App（app）。
// 詳しい手順は docs/DEPLOYMENT.md を参照してください。

@description('リソース名の接頭辞')
param appName string = 'tsunagari-map'

@description('デプロイ先リージョン')
param location string = resourceGroup().location

@description('Microsoft Entra テナントID')
param tenantId string

@description('API 用に登録した Entra アプリのクライアントID')
param apiClientId string

@description('API のアプリケーションID URI（例: api://tsunagari-map.example.com/<クライアントID>）')
param apiAudience string

@description('SharePoint サイトID（scripts/provision-sharepoint.mjs 実行後に確認）')
param spSiteId string

@description('Teams アプリのID（teams/.env.teams の TEAMS_APP_ID と同じ値）')
param teamsAppId string = ''

@description('Microsoft Graph 呼び出し用のクライアントシークレット。本番ではデプロイ後にマネージドID方式へ移行することを推奨')
@secure()
param graphClientSecret string

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
      linuxFxVersion: 'Node|20'
      cors: {
        allowedOrigins: empty(corsOrigin) ? [] : [corsOrigin]
      }
      appSettings: [
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'STORE', value: 'sharepoint' }
        { name: 'AUTH_DISABLED', value: 'false' }
        { name: 'TENANT_ID', value: tenantId }
        { name: 'API_CLIENT_ID', value: apiClientId }
        { name: 'API_AUDIENCE', value: apiAudience }
        { name: 'GRAPH_CLIENT_SECRET', value: graphClientSecret }
        { name: 'SP_SITE_ID', value: spSiteId }
        { name: 'TEAMS_APP_ID', value: teamsAppId }
        { name: 'APP_TIMEZONE', value: 'Asia/Tokyo' }
        { name: 'KAIZEN_REMIND_DAYS', value: kaizenRemindDays }
      ]
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
