// cosmos-nosql.bicep — Cosmos DB NoSQL API account + database + containers
// CRITICAL: This is a SEPARATE account from the Gremlin one because a single
// Cosmos DB account cannot serve both NoSQL and Gremlin APIs simultaneously.

@description('Environment name (dev or prod)')
param environment string

@description('Deployment location')
param location string

@description('Unique suffix for globally unique resource names')
param suffix string

resource cosmosNoSqlAccount 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: 'kt-cosmos-nosql-${suffix}'
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
    // Serverless mode — pay-per-request, ideal for dev/MVP
    capabilities: [
      { name: 'EnableServerless' }
    ]
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmosNoSqlAccount
  name: 'kt-agent'
  properties: {
    resource: {
      id: 'kt-agent'
    }
  }
}

// ──────────────────────────────────────────────
// Containers — each with its own partition key
// ──────────────────────────────────────────────

resource retireesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'retirees'
  properties: {
    resource: {
      id: 'retirees'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
    }
  }
}

resource knowledgeChunksContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'knowledge-chunks'
  properties: {
    resource: {
      id: 'knowledge-chunks'
      partitionKey: {
        paths: ['/retireeId']
        kind: 'Hash'
      }
    }
  }
}

resource interviewSessionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'interview-sessions'
  properties: {
    resource: {
      id: 'interview-sessions'
      partitionKey: {
        paths: ['/retireeId']
        kind: 'Hash'
      }
    }
  }
}

resource observationsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'observations'
  properties: {
    resource: {
      id: 'observations'
      partitionKey: {
        paths: ['/retireeId']
        kind: 'Hash'
      }
    }
  }
}

resource queriesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'queries'
  properties: {
    resource: {
      id: 'queries'
      partitionKey: {
        paths: ['/userId']
        kind: 'Hash'
      }
    }
  }
}

resource consentContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'consent'
  properties: {
    resource: {
      id: 'consent'
      partitionKey: {
        paths: ['/retireeId']
        kind: 'Hash'
      }
    }
  }
}

output cosmosNoSqlEndpoint string = cosmosNoSqlAccount.properties.documentEndpoint
output cosmosNoSqlAccountName string = cosmosNoSqlAccount.name
output cosmosNoSqlAccountId string = cosmosNoSqlAccount.id
