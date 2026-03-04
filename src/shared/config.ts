import { z } from 'zod';
import { ConfigError } from './errors.js';

const configSchema = z.object({
  openai: z.object({
    endpoint: z.string().url(),
    apiKey: z.string().min(1),
    chatDeployment: z.string().min(1),
    auxiliaryDeployment: z.string().min(1),
    embeddingDeployment: z.string().min(1),
    embeddingDimensions: z.coerce.number().int().positive().default(3072),
  }),
  search: z.object({
    endpoint: z.string().url(),
    apiKey: z.string().min(1),
    indexName: z.string().min(1),
  }),
  cosmosNoSql: z.object({
    endpoint: z.string().url(),
    key: z.string().min(1),
    database: z.string().min(1),
  }),
  cosmosGremlin: z.object({
    endpoint: z.string().min(1),
    key: z.string().min(1),
    database: z.string().min(1),
  }),
  graph: z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    tenantId: z.string().min(1),
  }),
  bot: z.object({
    id: z.string().min(1),
    password: z.string().min(1),
  }),
  monitoring: z.object({
    connectionString: z.string().min(1),
  }),
  port: z.coerce.number().int().positive().default(3978),
});

export type AppConfig = z.infer<typeof configSchema>;

function loadConfig(): AppConfig {
  const raw = {
    openai: {
      endpoint: process.env['AZURE_OPENAI_ENDPOINT'] ?? '',
      apiKey: process.env['AZURE_OPENAI_API_KEY'] ?? '',
      chatDeployment: process.env['AZURE_OPENAI_CHAT_DEPLOYMENT'] ?? process.env['AZURE_OPENAI_GPT4O_DEPLOYMENT'] ?? 'gpt-4o',
      auxiliaryDeployment: process.env['AZURE_OPENAI_AUXILIARY_DEPLOYMENT'] ?? process.env['AZURE_OPENAI_CHAT_DEPLOYMENT'] ?? process.env['AZURE_OPENAI_GPT4O_DEPLOYMENT'] ?? 'gpt-4o',
      embeddingDeployment: process.env['AZURE_OPENAI_EMBEDDING_DEPLOYMENT'] ?? 'text-embedding-3-large',
      embeddingDimensions: process.env['AZURE_OPENAI_EMBEDDING_DIMENSIONS'] ?? 3072,
    },
    search: {
      endpoint: process.env['AZURE_SEARCH_ENDPOINT'] ?? '',
      apiKey: process.env['AZURE_SEARCH_API_KEY'] ?? '',
      indexName: process.env['AZURE_SEARCH_INDEX'] ?? 'knowledge-chunks',
    },
    cosmosNoSql: {
      endpoint: process.env['COSMOS_NOSQL_ENDPOINT'] ?? '',
      key: process.env['COSMOS_NOSQL_KEY'] ?? '',
      database: process.env['COSMOS_NOSQL_DATABASE'] ?? 'kt-agent',
    },
    cosmosGremlin: {
      endpoint: process.env['COSMOS_GREMLIN_ENDPOINT'] ?? '',
      key: process.env['COSMOS_GREMLIN_KEY'] ?? '',
      database: process.env['COSMOS_GREMLIN_DATABASE'] ?? 'kt-graph',
    },
    graph: {
      clientId: process.env['GRAPH_CLIENT_ID'] ?? '',
      clientSecret: process.env['GRAPH_CLIENT_SECRET'] ?? '',
      tenantId: process.env['GRAPH_TENANT_ID'] ?? '',
    },
    bot: {
      id: process.env['BOT_ID'] ?? '',
      password: process.env['BOT_PASSWORD'] ?? '',
    },
    monitoring: {
      connectionString: process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'] ?? '',
    },
    port: process.env['PORT'] ?? 3978,
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const missing = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    );
    throw new ConfigError(
      `Invalid configuration:\n  ${missing.join('\n  ')}`,
      { issues: result.error.issues },
    );
  }

  return result.data;
}

export const config: AppConfig = loadConfig();
