import express from 'express';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from 'botbuilder';
import { config } from './shared/config.js';
import { logger } from './shared/logger.js';
import { CosmosNoSqlClient } from './storage/cosmos-nosql-client.js';
import { CosmosGremlinClient } from './storage/cosmos-gremlin-client.js';
import { SearchClientWrapper } from './storage/search-client.js';
import { EmbeddingService } from './pipeline/embedding.js';
import { InterviewAgent } from './agents/interview/interview-agent.js';
import { QueryAgent } from './agents/query/query-agent.js';
import { createBot } from './bot/bot.js';

async function main(): Promise<void> {
  logger.info('Initializing Knowledge Transfer Agent', {
    component: 'Main',
  });

  // ── Service initialization ──

  const cosmosClient = new CosmosNoSqlClient(
    config.cosmosNoSql.endpoint,
    config.cosmosNoSql.key,
    config.cosmosNoSql.database,
  );

  const gremlinClient = new CosmosGremlinClient(
    config.cosmosGremlin.endpoint,
    config.cosmosGremlin.key,
    config.cosmosGremlin.database,
  );

  const searchService = new SearchClientWrapper(
    config.search.endpoint,
    config.search.apiKey,
    config.search.indexName,
  );

  const embeddingService = new EmbeddingService(
    config.openai.endpoint,
    config.openai.embeddingDeployment,
    config.openai.chatDeployment,
    config.openai.embeddingDimensions,
  );

  // ── Agent initialization ──

  const interviewAgent = new InterviewAgent({
    projectEndpoint: config.openai.endpoint,
    cosmosClient,
    chatDeployment: config.openai.chatDeployment,
  });

  const queryAgent = new QueryAgent({
    searchService,
    cosmosClient,
    gremlinClient,
    embeddingService,
    openaiEndpoint: config.openai.endpoint,
    deploymentName: config.openai.chatDeployment,
  });

  // ── Bot setup ──

  const bot = createBot({
    interviewAgent,
    queryAgent,
    cosmosClient,
  });

  const botAuth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: config.bot.id,
    MicrosoftAppPassword: config.bot.password,
    MicrosoftAppType: 'MultiTenant',
  });

  const adapter = new CloudAdapter(botAuth);

  adapter.onTurnError = async (context, error) => {
    logger.error('Unhandled bot error', {
      component: 'Adapter',
      error: error instanceof Error ? error : undefined,
    });

    await context
      .sendActivity('⚠️ Sorry, something went wrong. Please try again later.')
      .catch(() => {
        // Swallow send errors during error handling
      });
  };

  // ── Express server ──

  const app = express();
  app.use(express.json());

  app.post('/api/messages', async (req, res) => {
    await adapter.process(req, res, async (context) => {
      await bot.run(context);
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    });
  });

  const port = config.port;
  app.listen(port, () => {
    logger.info(`Server listening on port ${port}`, {
      component: 'Main',
      operation: 'listen',
    });
  });
}

main().catch((error: unknown) => {
  logger.error('Fatal startup error', {
    component: 'Main',
    error: error instanceof Error ? error : undefined,
  });
  process.exit(1);
});
