// bot-service.bicep — Azure Bot Service (Teams channel)
// Uses MultiTenant MSA app type for broad organizational access.

@description('Unique suffix for globally unique resource names')
param suffix string

@description('Deployment location')
param location string

@description('Microsoft App ID (Entra ID app registration) for the bot')
param botAppId string

@description('Function App URL for the messaging endpoint')
param functionAppUrl string

@description('Environment name (dev or prod)')
param environment string

// Bot Service must use 'global' location for the resource itself,
// but the underlying app registration is regional.
resource botService 'Microsoft.BotService/botServices@2022-09-15' = {
  name: 'kt-bot-${suffix}'
  location: 'global'
  kind: 'azurebot'
  sku: {
    name: 'F0' // Free tier
  }
  properties: {
    displayName: 'Knowledge Transfer Agent'
    description: 'Bot for capturing and retrieving institutional knowledge from retiring employees'
    endpoint: '${functionAppUrl}/api/messages'
    msaAppId: botAppId
    msaAppType: 'MultiTenant'
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

// Enable the Teams channel
resource teamsChannel 'Microsoft.BotService/botServices/channels@2022-09-15' = {
  parent: botService
  name: 'MsTeamsChannel'
  location: 'global'
  properties: {
    channelName: 'MsTeamsChannel'
    properties: {
      isEnabled: true
    }
  }
}

output botEndpoint string = botService.properties.endpoint
output botServiceName string = botService.name
