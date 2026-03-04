// main.bicep — Orchestrator for Knowledge Transfer Agent MVP infrastructure
// Deploys all Azure resources in dependency order.

targetScope = 'resourceGroup'

// ──────────────────────────────────────────────
// Parameters
// ──────────────────────────────────────────────

@description('Environment name')
@allowed(['dev', 'prod'])
param environment string

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Unique suffix for globally unique resource names')
param suffix string = uniqueString(resourceGroup().id)

@description('Microsoft App ID (Entra ID app registration) for the Bot Service')
param botAppId string = ''

// ──────────────────────────────────────────────
// Module Deployments (in dependency order)
// ──────────────────────────────────────────────

// 1. Identity + Storage — no dependencies
module identity 'modules/identity.bicep' = {
  name: 'identity-${environment}'
  params: {
    environment: environment
    location: location
    suffix: suffix
  }
}

// 2. Key Vault — depends on identity (needs principalId for RBAC)
module keyVault 'modules/key-vault.bicep' = {
  name: 'keyVault-${environment}'
  params: {
    environment: environment
    location: location
    suffix: suffix
    identityPrincipalId: identity.outputs.identityPrincipalId
  }
}

// 3. Monitoring — no dependencies
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring-${environment}'
  params: {
    environment: environment
    location: location
    suffix: suffix
  }
}

// 4. Azure OpenAI — no dependencies
module openai 'modules/openai.bicep' = {
  name: 'openai-${environment}'
  params: {
    environment: environment
    location: location
    suffix: suffix
  }
}

// 5. Cosmos DB NoSQL — no dependencies
module cosmosNoSql 'modules/cosmos-nosql.bicep' = {
  name: 'cosmosNoSql-${environment}'
  params: {
    environment: environment
    location: location
    suffix: suffix
  }
}

// 6. Cosmos DB Gremlin — no dependencies
module cosmosGremlin 'modules/cosmos-gremlin.bicep' = {
  name: 'cosmosGremlin-${environment}'
  params: {
    environment: environment
    location: location
    suffix: suffix
  }
}

// 7. AI Search — no dependencies
module aiSearch 'modules/ai-search.bicep' = {
  name: 'aiSearch-${environment}'
  params: {
    environment: environment
    location: location
    suffix: suffix
  }
}

// 8. AI Foundry — depends on Key Vault, Storage, App Insights, OpenAI
module aiFoundry 'modules/ai-foundry.bicep' = {
  name: 'aiFoundry-${environment}'
  params: {
    environment: environment
    location: location
    suffix: suffix
    keyVaultId: keyVault.outputs.keyVaultId
    storageAccountId: identity.outputs.storageAccountId
    appInsightsId: monitoring.outputs.appInsightsId
    openaiAccountId: openai.outputs.openaiAccountId
    openaiEndpoint: openai.outputs.openaiEndpoint
  }
}

// 9. Functions — depends on monitoring, OpenAI, Cosmos, AI Search, Key Vault, identity
module functions 'modules/functions.bicep' = {
  name: 'functions-${environment}'
  params: {
    environment: environment
    location: location
    suffix: suffix
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    openaiEndpoint: openai.outputs.openaiEndpoint
    cosmosNoSqlEndpoint: cosmosNoSql.outputs.cosmosNoSqlEndpoint
    cosmosGremlinEndpoint: cosmosGremlin.outputs.cosmosGremlinEndpoint
    aiSearchEndpoint: aiSearch.outputs.aiSearchEndpoint
    keyVaultUri: keyVault.outputs.keyVaultUri
    identityId: identity.outputs.identityId
    identityClientId: identity.outputs.identityClientId
  }
}

// 10. Bot Service — depends on Functions
module botService 'modules/bot-service.bicep' = {
  name: 'botService-${environment}'
  params: {
    suffix: suffix
    location: location
    botAppId: botAppId
    functionAppUrl: functions.outputs.functionAppUrl
    environment: environment
  }
}

// ──────────────────────────────────────────────
// Outputs — key endpoints for application configuration
// ──────────────────────────────────────────────

output functionAppUrl string = functions.outputs.functionAppUrl
output botEndpoint string = botService.outputs.botEndpoint
output aiSearchEndpoint string = aiSearch.outputs.aiSearchEndpoint
output cosmosNoSqlEndpoint string = cosmosNoSql.outputs.cosmosNoSqlEndpoint
output cosmosGremlinEndpoint string = cosmosGremlin.outputs.cosmosGremlinEndpoint
output aiFoundryProjectId string = aiFoundry.outputs.aiFoundryProjectId
