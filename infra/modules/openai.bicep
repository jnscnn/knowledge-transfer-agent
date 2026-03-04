// openai.bicep — Azure OpenAI account + model deployments
//
// Model selection is parameterized — change the defaults below to deploy
// a different chat or embedding model without modifying the template.
// Deployments are serial (dependsOn) because Azure OpenAI only allows one
// deployment operation at a time per account.

@description('Environment name (dev or prod)')
param environment string

@description('Deployment location')
param location string

@description('Unique suffix for globally unique resource names')
param suffix string

// ── Model selection parameters ──

@description('Chat completion model name (e.g., gpt-4o, gpt-4.1, o3-mini, gpt-4o-mini)')
param chatModelName string = 'gpt-4o'

@description('Chat completion model version')
param chatModelVersion string = '2024-08-06'

@description('Chat model deployment name — used as AZURE_OPENAI_CHAT_DEPLOYMENT env var')
param chatDeploymentName string = chatModelName

@description('Chat model capacity in thousands of tokens per minute (TPM)')
param chatCapacity int = 30

@description('Embedding model name (e.g., text-embedding-3-large, text-embedding-3-small)')
param embeddingModelName string = 'text-embedding-3-large'

@description('Embedding model version')
param embeddingModelVersion string = '1'

@description('Embedding model deployment name — used as AZURE_OPENAI_EMBEDDING_DEPLOYMENT env var')
param embeddingDeploymentName string = embeddingModelName

@description('Embedding model capacity in thousands of tokens per minute (TPM)')
param embeddingCapacity int = 120

resource openaiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'kt-openai-${suffix}'
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'kt-openai-${suffix}'
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

// Chat completion model for agent reasoning, interviews, and query answers
resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openaiAccount
  name: chatDeploymentName
  sku: {
    name: 'Standard'
    capacity: chatCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: chatModelName
      version: chatModelVersion
    }
  }
}

// Embedding model for vectorizing knowledge chunks
resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openaiAccount
  name: embeddingDeploymentName
  sku: {
    name: 'Standard'
    capacity: embeddingCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: embeddingModelName
      version: embeddingModelVersion
    }
  }
  // Azure OpenAI processes deployment operations serially per account
  dependsOn: [chatDeployment]
}

output openaiEndpoint string = openaiAccount.properties.endpoint
output openaiAccountId string = openaiAccount.id
output openaiAccountName string = openaiAccount.name
output chatDeploymentOutput string = chatDeploymentName
output embeddingDeploymentOutput string = embeddingDeploymentName
