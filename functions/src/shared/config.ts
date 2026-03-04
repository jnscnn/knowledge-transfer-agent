// Shared configuration helpers for Azure Functions

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function getCosmosClient(): { client: CosmosClient; databaseId: string } {
  const endpoint = requireEnv('COSMOS_NOSQL_ENDPOINT');
  const key = process.env['COSMOS_NOSQL_KEY'];
  const databaseId = optionalEnv('COSMOS_NOSQL_DATABASE', 'kt-agent');

  const client = key
    ? new CosmosClient({ endpoint, key })
    : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

  return { client, databaseId };
}

export function getGraphClient(): Client {
  const tenantId = requireEnv('GRAPH_TENANT_ID');
  const clientId = requireEnv('GRAPH_CLIENT_ID');
  const clientSecret = requireEnv('GRAPH_CLIENT_SECRET');

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });

  return Client.initWithMiddleware({ authProvider });
}

export function getSearchConfig(): { endpoint: string; apiKey: string; indexName: string } {
  return {
    endpoint: requireEnv('AZURE_SEARCH_ENDPOINT'),
    apiKey: requireEnv('AZURE_SEARCH_API_KEY'),
    indexName: optionalEnv('AZURE_SEARCH_INDEX', 'knowledge-chunks'),
  };
}

export function getOpenAIConfig(): { endpoint: string; deployment: string } {
  return {
    endpoint: requireEnv('AZURE_OPENAI_ENDPOINT'),
    deployment: optionalEnv('AZURE_OPENAI_GPT4O_DEPLOYMENT', 'gpt-4o'),
  };
}

export function getGremlinConfig(): { endpoint: string; key: string; database: string } {
  return {
    endpoint: requireEnv('COSMOS_GREMLIN_ENDPOINT'),
    key: requireEnv('COSMOS_GREMLIN_KEY'),
    database: optionalEnv('COSMOS_GREMLIN_DATABASE', 'kt-graph'),
  };
}
