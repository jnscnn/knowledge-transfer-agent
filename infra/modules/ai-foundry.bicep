// ai-foundry.bicep — Azure AI Foundry (Hub + Project)
// IMPORTANT: Uses Microsoft.MachineLearningServices — there is NO Microsoft.AIFoundry provider.
// The Hub is the organizational container; the Project is where agents run.

@description('Environment name (dev or prod)')
param environment string

@description('Deployment location')
param location string

@description('Unique suffix for globally unique resource names')
param suffix string

@description('Key Vault resource ID (required by Hub)')
param keyVaultId string

@description('Storage Account resource ID (required by Hub)')
param storageAccountId string

@description('Application Insights resource ID (required by Hub)')
param appInsightsId string

@description('Azure OpenAI account resource ID for the connection')
param openaiAccountId string

@description('Azure OpenAI endpoint URL for the connection target')
param openaiEndpoint string

// ──────────────────────────────────────────────
// AI Hub — organizational container for AI projects
// ──────────────────────────────────────────────
resource aiHub 'Microsoft.MachineLearningServices/workspaces@2024-10-01' = {
  name: 'kt-ai-hub-${suffix}'
  location: location
  kind: 'Hub'
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    friendlyName: 'Knowledge Transfer AI Hub'
    description: 'AI Hub for the Knowledge Transfer Agent MVP'
    keyVault: keyVaultId
    storageAccount: storageAccountId
    applicationInsights: appInsightsId
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

// ──────────────────────────────────────────────
// OpenAI Connection on the Hub
// Uses AAD (Entra ID) auth — no API keys stored
// ──────────────────────────────────────────────
resource openaiConnection 'Microsoft.MachineLearningServices/workspaces/connections@2024-10-01' = {
  parent: aiHub
  name: 'kt-openai-connection'
  properties: {
    category: 'AzureOpenAI'
    authType: 'AAD'
    target: openaiEndpoint
    metadata: {
      ApiType: 'Azure'
      ResourceId: openaiAccountId
    }
  }
}

// ──────────────────────────────────────────────
// AI Project — where agents and prompt flows run
// ──────────────────────────────────────────────
resource aiProject 'Microsoft.MachineLearningServices/workspaces@2024-10-01' = {
  name: 'kt-ai-project-${suffix}'
  location: location
  kind: 'Project'
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    friendlyName: 'Knowledge Transfer Agent Project'
    description: 'AI Project for interview orchestration and knowledge retrieval'
    // Link the project to the hub
    hubResourceId: aiHub.id
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

output aiFoundryHubId string = aiHub.id
output aiFoundryProjectId string = aiProject.id
output aiFoundryProjectName string = aiProject.name
