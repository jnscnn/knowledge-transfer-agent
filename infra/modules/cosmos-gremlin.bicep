// cosmos-gremlin.bicep — Cosmos DB Gremlin API account + database + graph
// CRITICAL: Separate account from NoSQL — a single Cosmos DB account cannot
// serve both NoSQL and Gremlin APIs. The Gremlin capability must be set at
// account creation and cannot be changed later.

@description('Environment name (dev or prod)')
param environment string

@description('Deployment location')
param location string

@description('Unique suffix for globally unique resource names')
param suffix string

resource cosmosGremlinAccount 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: 'kt-cosmos-graph-${suffix}'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    // Both capabilities are required: Gremlin API + Serverless mode
    capabilities: [
      { name: 'EnableServerless' }
      { name: 'EnableGremlin' }
    ]
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

resource gremlinDatabase 'Microsoft.DocumentDB/databaseAccounts/gremlinDatabases@2024-11-15' = {
  parent: cosmosGremlinAccount
  name: 'kt-graph'
  properties: {
    resource: {
      id: 'kt-graph'
    }
  }
}

resource knowledgeGraph 'Microsoft.DocumentDB/databaseAccounts/gremlinDatabases/graphs@2024-11-15' = {
  parent: gremlinDatabase
  name: 'knowledge-graph'
  properties: {
    resource: {
      id: 'knowledge-graph'
      partitionKey: {
        paths: ['/retireeId']
        kind: 'Hash'
      }
    }
  }
}

// Gremlin WSS endpoint follows the pattern: wss://<accountName>.gremlin.cosmos.azure.com:443/
output cosmosGremlinEndpoint string = 'wss://${cosmosGremlinAccount.name}.gremlin.cosmos.azure.com:443/'
output cosmosGremlinDocumentEndpoint string = cosmosGremlinAccount.properties.documentEndpoint
output cosmosGremlinAccountName string = cosmosGremlinAccount.name
