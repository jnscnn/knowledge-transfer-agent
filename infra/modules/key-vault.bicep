// key-vault.bicep — Azure Key Vault for secret management
// Uses RBAC authorization (preferred over access policies for new deployments).

@description('Environment name (dev or prod)')
param environment string

@description('Deployment location')
param location string

@description('Unique suffix for globally unique resource names')
param suffix string

@description('Principal ID of the managed identity to grant access')
param identityPrincipalId string

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kt-kv-${suffix}'
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    // Enable RBAC authorization instead of access policies for better security posture
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
  tags: {
    environment: environment
    project: 'knowledge-transfer-agent'
  }
}

// Key Vault Secrets Officer — allows the managed identity to read/write secrets
var keyVaultSecretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource secretsOfficerRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identityPrincipalId, keyVaultSecretsOfficerRoleId)
  scope: keyVault
  properties: {
    principalId: identityPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficerRoleId)
    principalType: 'ServicePrincipal'
  }
}

output keyVaultId string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
