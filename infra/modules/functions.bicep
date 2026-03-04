// functions.bicep — Azure Functions (Consumption plan, Node.js 20, Linux)
// The Function App hosts the Bot Framework endpoint and background processing.

@description('Environment name (dev or prod)')
param environment string

@description('Deployment location')
param location string

@description('Unique suffix for globally unique resource names')
param suffix string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Azure OpenAI endpoint')
param openaiEndpoint string

@description('Cosmos DB NoSQL endpoint')
param cosmosNoSqlEndpoint string

@description('Cosmos DB Gremlin WSS endpoint')
param cosmosGremlinEndpoint string

@description('Azure AI Search endpoint')
param aiSearchEndpoint string

@description('Key Vault URI for secret references')
param keyVaultUri string

@description('User-assigned managed identity resource ID')
param identityId string

@description('User-assigned managed identity client ID')
param identityClientId string

// ──────────────────────────────────────────────
// Storage Account for Function App runtime
// (Separate from the AI Foundry storage account)
// ──────────────────────────────────────────────
resource funcStorageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'ktfunc${suffix}'
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

// ──────────────────────────────────────────────
// Consumption Plan (Y1 SKU)
// ──────────────────────────────────────────────
resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'kt-func-plan-${suffix}'
  location: location
  kind: 'linux'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Required for Linux
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

// ──────────────────────────────────────────────
// Function App
// ──────────────────────────────────────────────
resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'kt-func-${suffix}'
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${funcStorageAccount.name};EndpointSuffix=${az.environment().suffixes.storage};AccountKey=${funcStorageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${funcStorageAccount.name};EndpointSuffix=${az.environment().suffixes.storage};AccountKey=${funcStorageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: 'kt-func-${suffix}'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        // Service endpoints — no secrets, just URLs (auth via managed identity)
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: openaiEndpoint
        }
        {
          name: 'COSMOS_NOSQL_ENDPOINT'
          value: cosmosNoSqlEndpoint
        }
        {
          name: 'COSMOS_GREMLIN_ENDPOINT'
          value: cosmosGremlinEndpoint
        }
        {
          name: 'AI_SEARCH_ENDPOINT'
          value: aiSearchEndpoint
        }
        {
          name: 'KEY_VAULT_URI'
          value: keyVaultUri
        }
        // Managed identity client ID for DefaultAzureCredential
        {
          name: 'AZURE_CLIENT_ID'
          value: identityClientId
        }
      ]
    }
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output functionAppName string = functionApp.name
output functionAppPrincipalId string = functionApp.identity.principalId
