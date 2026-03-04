// Timer trigger: weekly consistency check across AI Search, Cosmos DB, and Gremlin graph

import { app, type InvocationContext, type Timer } from '@azure/functions';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { driver as gremlinDriver } from 'gremlin';
import { getCosmosClient, getSearchConfig, getGremlinConfig } from '../shared/config.js';
import type { ConsistencyResult } from '../shared/types.js';

interface SearchDoc {
  id: string;
  retireeId: string;
}

interface CosmosChunk {
  id: string;
  retireeId: string;
}

app.timer('consistency-check', {
  schedule: '0 0 2 * * 0', // Weekly on Sunday at 02:00 UTC
  handler: async (_timer: Timer, context: InvocationContext) => {
    context.log('Starting cross-store consistency check');

    const startTime = Date.now();

    try {
      // 1. Query Cosmos DB for all knowledge chunks
      const { client: cosmosClient, databaseId } = getCosmosClient();
      const db = cosmosClient.database(databaseId);

      const cosmosResult = await db
        .container('knowledgeChunks')
        .items.query<CosmosChunk>({
          query: 'SELECT c.id, c.retireeId FROM c',
        })
        .fetchAll();

      const cosmosIds = new Set(cosmosResult.resources.map((r) => r.id));

      // 2. Query AI Search for all indexed documents
      const searchConfig = getSearchConfig();
      const searchClient = new SearchClient<SearchDoc>(
        searchConfig.endpoint,
        searchConfig.indexName,
        new AzureKeyCredential(searchConfig.apiKey),
      );

      const searchIds = new Set<string>();
      const searchResults = await searchClient.search('*', {
        select: ['id', 'retireeId'],
        top: 10000,
      });

      for await (const result of searchResults.results) {
        if (result.document.id) {
          searchIds.add(result.document.id);
        }
      }

      // 3. Query Gremlin for entity count
      const gremlinConfig = getGremlinConfig();
      let gremlinEntityCount = 0;

      try {
        const authenticator = new gremlinDriver.auth.PlainTextSaslAuthenticator(
          `/dbs/${gremlinConfig.database}/colls/entities`,
          gremlinConfig.key,
        );
        const gremlinClient = new gremlinDriver.Client(gremlinConfig.endpoint, {
          authenticator,
          traversalSource: 'g',
          rejectUnauthorized: true,
          mimeType: 'application/vnd.gremlin-v2.0+json',
        });

        await gremlinClient.open();
        const countResult = await gremlinClient.submit('g.V().count()');
        gremlinEntityCount = Number(countResult.first()) || 0;
        await gremlinClient.close();
      } catch (gremlinError: unknown) {
        const msg = gremlinError instanceof Error ? gremlinError.message : String(gremlinError);
        context.warn(`Gremlin query failed: ${msg}`);
      }

      // 4. Compute discrepancies
      const missingInSearch: string[] = [];
      for (const cosmosId of cosmosIds) {
        if (!searchIds.has(cosmosId)) {
          missingInSearch.push(cosmosId);
        }
      }

      const missingInCosmos: string[] = [];
      for (const searchId of searchIds) {
        if (!cosmosIds.has(searchId)) {
          missingInCosmos.push(searchId);
        }
      }

      const result: ConsistencyResult = {
        timestamp: new Date().toISOString(),
        cosmosCount: cosmosIds.size,
        searchCount: searchIds.size,
        gremlinEntityCount,
        missingInSearch: missingInSearch.slice(0, 100),
        missingInCosmos: missingInCosmos.slice(0, 100),
        orphanedInGremlin: [], // Would require cross-referencing Gremlin vertices with Cosmos
        isConsistent:
          missingInSearch.length === 0 && missingInCosmos.length === 0,
      };

      // Store the result in Cosmos
      await db.container('observations').items.upsert({
        id: `consistency-${result.timestamp}`,
        type: 'consistency-check',
        ...result,
        durationMs: Date.now() - startTime,
      });

      if (result.isConsistent) {
        context.log(
          `Consistency check passed: ${result.cosmosCount} Cosmos, ${result.searchCount} Search, ${result.gremlinEntityCount} Gremlin entities`,
        );
      } else {
        context.warn(
          `Consistency check found discrepancies: ${missingInSearch.length} missing in Search, ${missingInCosmos.length} missing in Cosmos`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      context.error(`Consistency check failed: ${message}`);
      throw error;
    }
  },
});
