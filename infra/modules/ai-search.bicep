// ai-search.bicep — Azure AI Search (formerly Cognitive Search)
// S1 tier with semantic search enabled for hybrid retrieval.

@description('Environment name (dev or prod)')
param environment string

@description('Deployment location')
param location string

@description('Unique suffix for globally unique resource names')
param suffix string

resource aiSearch 'Microsoft.Search/searchServices@2024-07-01' = {
  name: 'kt-search-${suffix}'
  location: location
  sku: {
    name: 'standard' // S1 — supports semantic search + vector search
  }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    semanticSearch: 'standard'
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

output aiSearchEndpoint string = 'https://${aiSearch.name}.search.windows.net'
output aiSearchName string = aiSearch.name
output aiSearchId string = aiSearch.id
