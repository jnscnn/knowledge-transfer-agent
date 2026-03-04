// openai.bicep — Azure OpenAI account + model deployments
// Deployments are serial (dependsOn) because Azure OpenAI only allows one
// deployment operation at a time per account.

@description('Environment name (dev or prod)')
param environment string

@description('Deployment location')
param location string

@description('Unique suffix for globally unique resource names')
param suffix string

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

// GPT-4o for chat completions and agent reasoning
resource gpt4oDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openaiAccount
  name: 'gpt-4o'
  sku: {
    name: 'Standard'
    capacity: 30
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o'
      version: '2024-08-06'
    }
  }
}

// text-embedding-3-large for vectorizing knowledge chunks
resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openaiAccount
  name: 'text-embedding-3-large'
  sku: {
    name: 'Standard'
    capacity: 120
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-large'
      version: '1'
    }
  }
  // Azure OpenAI processes deployment operations serially per account
  dependsOn: [gpt4oDeployment]
}

output openaiEndpoint string = openaiAccount.properties.endpoint
output openaiAccountId string = openaiAccount.id
output openaiAccountName string = openaiAccount.name
