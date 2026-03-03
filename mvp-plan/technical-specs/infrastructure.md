# Infrastructure Specification

## Overview

Azure infrastructure for the Knowledge Transfer Agent MVP, defined as Bicep templates with environment-specific parameters.

## Resource Inventory

| Resource | SKU/Tier | Estimated Monthly Cost | Purpose |
|----------|----------|----------------------|---------|
| Azure AI Foundry | Standard | ~$0 (pay per inference) | Agent orchestration |
| Azure OpenAI | Standard | ~$100-300 (usage-based) | GPT-4o + embeddings |
| Azure AI Search | S1 Standard | ~$250 | Vector + keyword search |
| Azure Cosmos DB | Serverless | ~$50-100 (usage-based) | Knowledge graph + metadata |
| Azure Functions | Consumption | ~$10-30 | Event processing pipeline |
| Azure Bot Service | Standard | $0 (free tier) | Teams bot registration |
| Azure Key Vault | Standard | ~$5 | Secrets management |
| Azure Blob Storage | Hot | ~$10-20 | Raw data lake |
| Application Insights | Pay-as-you-go | ~$10-20 | Monitoring + telemetry |
| Log Analytics | Pay-as-you-go | ~$10-20 | Audit logs |
| **Total (estimated)** | | **~$450-750/month** | For MVP pilot |

## Bicep Template Structure

### Main Template (`main.bicep`)

```bicep
targetScope = 'resourceGroup'

@description('Environment name')
@allowed(['dev', 'prod'])
param environment string

@description('Azure region')
param location string = resourceGroup().location

@description('Unique suffix for resource names')
param suffix string = uniqueString(resourceGroup().id)

// Modules
module identity 'modules/identity.bicep' = {
  name: 'identity'
  params: { location: location, suffix: suffix, environment: environment }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'keyVault'
  params: { location: location, suffix: suffix, identityId: identity.outputs.managedIdentityId }
}

module openai 'modules/openai.bicep' = {
  name: 'openai'
  params: { location: location, suffix: suffix }
}

module cosmosDb 'modules/cosmos-db.bicep' = {
  name: 'cosmosDb'
  params: { location: location, suffix: suffix }
}

module aiSearch 'modules/ai-search.bicep' = {
  name: 'aiSearch'
  params: { location: location, suffix: suffix }
}

module functions 'modules/functions.bicep' = {
  name: 'functions'
  params: {
    location: location
    suffix: suffix
    cosmosDbConnectionString: cosmosDb.outputs.connectionString
    aiSearchEndpoint: aiSearch.outputs.endpoint
    openaiEndpoint: openai.outputs.endpoint
    keyVaultUri: keyVault.outputs.uri
    identityId: identity.outputs.managedIdentityId
  }
}

module botService 'modules/bot-service.bicep' = {
  name: 'botService'
  params: { location: location, suffix: suffix }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: { location: location, suffix: suffix }
}

// Outputs
output functionAppUrl string = functions.outputs.url
output botEndpoint string = botService.outputs.endpoint
output aiSearchEndpoint string = aiSearch.outputs.endpoint
output cosmosDbEndpoint string = cosmosDb.outputs.endpoint
```

### Azure OpenAI Module (`modules/openai.bicep`)

```bicep
param location string
param suffix string

resource openaiAccount 'Microsoft.CognitiveServices/accounts@2024-04-01-preview' = {
  name: 'kt-openai-${suffix}'
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: 'kt-openai-${suffix}'
    publicNetworkAccess: 'Enabled' // Disable in prod, use private endpoints
  }
}

resource gpt4o 'Microsoft.CognitiveServices/accounts/deployments@2024-04-01-preview' = {
  parent: openaiAccount
  name: 'gpt-4o'
  sku: { name: 'GlobalStandard', capacity: 30 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4o', version: '2024-08-06' }
  }
}

resource embedding 'Microsoft.CognitiveServices/accounts/deployments@2024-04-01-preview' = {
  parent: openaiAccount
  name: 'text-embedding-3-large'
  sku: { name: 'Standard', capacity: 120 }
  properties: {
    model: { format: 'OpenAI', name: 'text-embedding-3-large', version: '1' }
  }
  dependsOn: [gpt4o] // Serial deployment required
}

output endpoint string = openaiAccount.properties.endpoint
output accountId string = openaiAccount.id
```

### Cosmos DB Module (`modules/cosmos-db.bicep`)

```bicep
param location string
param suffix string

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-02-15-preview' = {
  name: 'kt-cosmos-${suffix}'
  location: location
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [
      { name: 'EnableServerless' }
      { name: 'EnableGremlin' }
    ]
    locations: [{ locationName: location, failoverPriority: 0 }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
  }
}

resource sqlDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-02-15-preview' = {
  parent: cosmosAccount
  name: 'kt-agent'
  properties: { resource: { id: 'kt-agent' } }
}

// NoSQL containers
var containers = [
  { name: 'retirees', partitionKey: '/id' }
  { name: 'knowledge-chunks', partitionKey: '/retireeId' }
  { name: 'interview-sessions', partitionKey: '/retireeId' }
  { name: 'observations', partitionKey: '/retireeId' }
  { name: 'queries', partitionKey: '/userId' }
  { name: 'consent', partitionKey: '/retireeId' }
]

resource sqlContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = [
  for container in containers: {
    parent: sqlDatabase
    name: container.name
    properties: {
      resource: {
        id: container.name
        partitionKey: { paths: [container.partitionKey], kind: 'Hash' }
      }
    }
  }
]

// Gremlin database for knowledge graph
resource gremlinDatabase 'Microsoft.DocumentDB/databaseAccounts/gremlinDatabases@2024-02-15-preview' = {
  parent: cosmosAccount
  name: 'kt-graph'
  properties: { resource: { id: 'kt-graph' } }
}

resource gremlinGraph 'Microsoft.DocumentDB/databaseAccounts/gremlinDatabases/graphs@2024-02-15-preview' = {
  parent: gremlinDatabase
  name: 'knowledge-graph'
  properties: {
    resource: {
      id: 'knowledge-graph'
      partitionKey: { paths: ['/retireeId'], kind: 'Hash' }
    }
  }
}

output connectionString string = cosmosAccount.listConnectionStrings().connectionStrings[0].connectionString
output endpoint string = cosmosAccount.properties.documentEndpoint
```

## Deployment Commands

```bash
# Create resource group
az group create --name kt-agent-rg --location eastus2

# Deploy dev environment
az deployment group create \
  --resource-group kt-agent-rg \
  --template-file infra/main.bicep \
  --parameters infra/parameters/dev.bicepparam

# Deploy prod environment
az deployment group create \
  --resource-group kt-agent-prod-rg \
  --template-file infra/main.bicep \
  --parameters infra/parameters/prod.bicepparam
```

## Environment Variables

```env
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://kt-openai-{suffix}.openai.azure.com/
AZURE_OPENAI_GPT4O_DEPLOYMENT=gpt-4o
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large

# Azure AI Search
AZURE_SEARCH_ENDPOINT=https://kt-search-{suffix}.search.windows.net
AZURE_SEARCH_INDEX=knowledge-chunks

# Cosmos DB
COSMOS_DB_ENDPOINT=https://kt-cosmos-{suffix}.documents.azure.com:443/
COSMOS_DB_DATABASE=kt-agent
COSMOS_GREMLIN_ENDPOINT=wss://kt-cosmos-{suffix}.gremlin.cosmos.azure.com:443/

# Azure Functions
FUNCTION_APP_URL=https://kt-functions-{suffix}.azurewebsites.net

# Bot Service
BOT_ID={entra-app-id}
BOT_PASSWORD={from-key-vault}

# Graph API
GRAPH_CLIENT_ID={entra-app-id}
GRAPH_TENANT_ID={tenant-id}

# Key Vault
KEY_VAULT_URI=https://kt-kv-{suffix}.vault.azure.net/

# Application Insights
APPLICATIONINSIGHTS_CONNECTION_STRING={from-deployment}
```

## Security Hardening (Production)

- [ ] Enable private endpoints for all Azure services
- [ ] Disable public network access on Cosmos DB, AI Search, OpenAI
- [ ] Deploy into Azure Virtual Network with NSG rules
- [ ] Enable Azure Front Door with WAF for web dashboard
- [ ] Enable diagnostic logging on all resources
- [ ] Configure Azure Policy for compliance enforcement
- [ ] Enable Microsoft Defender for Cloud
- [ ] Set up cost alerts at $500 and $1000 thresholds
