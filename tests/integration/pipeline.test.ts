import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all Azure dependencies
vi.mock('tiktoken', () => ({
  get_encoding: vi.fn(() => ({
    encode: vi.fn((text: string) => {
      const tokens = [];
      for (let i = 0; i < Math.ceil(text.length / 4); i++) tokens.push(i);
      return tokens;
    }),
    decode: vi.fn((tokens: number[]) => new Uint8Array(tokens.length * 4)),
    free: vi.fn(),
  })),
}));

vi.mock('openai', () => {
  const mockCreate = vi.fn().mockImplementation(async (opts: Record<string, unknown>) => {
    // Check if it's a sensitivity classification call (max_tokens=20) vs entity extraction (max_tokens=2000)
    if (opts['max_tokens'] === 20) {
      return {
        choices: [{ message: { content: 'internal' } }],
      };
    }
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            entities: [
              { text: 'Acme Corp', type: 'Vendor', confidence: 0.95 },
              { text: 'Sarah Chen', type: 'Person', confidence: 0.9 },
              { text: 'TechStar Solutions', type: 'Vendor', confidence: 0.92 },
            ],
            relationships: [
              {
                sourceEntity: 'Sarah Chen',
                targetEntity: 'Acme Corp',
                type: 'contacts',
                context: 'Account executive relationship',
                confidence: 0.85,
              },
            ],
          }),
        },
      }],
    };
  });
  return {
    AzureOpenAI: vi.fn().mockImplementation(() => ({
      chat: {
        completions: { create: mockCreate },
      },
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: new Array(3072).fill(0.1) }],
        }),
      },
    })),
    _mockChatCreate: mockCreate,
  };
});

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn(),
  getBearerTokenProvider: vi.fn(() => vi.fn()),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

vi.mock('../../src/shared/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { IndexingService } from '../../src/pipeline/indexing.js';
import type { SearchClientWrapper } from '../../src/storage/search-client.js';
import type { CosmosNoSqlClient } from '../../src/storage/cosmos-nosql-client.js';
import type { CosmosGremlinClient } from '../../src/storage/cosmos-gremlin-client.js';
import type { EmbeddingService } from '../../src/pipeline/embedding.js';
import { sampleInterviewTranscript } from '../fixtures/sample-interview.js';

function makeMockSearch(): SearchClientWrapper {
  return {
    indexChunk: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    deleteChunk: vi.fn().mockResolvedValue(undefined),
    getChunk: vi.fn().mockResolvedValue({}),
    getIndexClient: vi.fn(),
    getSearchIndexName: vi.fn().mockReturnValue('knowledge-chunks'),
  } as unknown as SearchClientWrapper;
}

function makeMockCosmos(): CosmosNoSqlClient {
  return {
    upsert: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    read: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as CosmosNoSqlClient;
}

function makeMockGremlin(): CosmosGremlinClient {
  return {
    addVertex: vi.fn().mockResolvedValue({ id: 'v1', label: 'entity', properties: {} }),
    addEdge: vi.fn().mockResolvedValue({ id: 'e1', label: 'uses', inV: '', outV: '', properties: {} }),
    getVertex: vi.fn().mockResolvedValue(undefined),
    getNeighbors: vi.fn().mockResolvedValue([]),
    query: vi.fn().mockResolvedValue([]),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as CosmosGremlinClient;
}

function makeMockEmbedding(): EmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Array(3072).fill(0.1)),
    embedBatch: vi.fn().mockResolvedValue([new Array(3072).fill(0.1)]),
    embedWithHyde: vi.fn().mockResolvedValue(new Array(3072).fill(0.1)),
    client: { baseURL: 'https://test.openai.azure.com/openai' },
  } as unknown as EmbeddingService;
}

describe('Pipeline Integration', () => {
  let searchService: ReturnType<typeof makeMockSearch>;
  let cosmosClient: ReturnType<typeof makeMockCosmos>;
  let gremlinClient: ReturnType<typeof makeMockGremlin>;
  let embeddingService: ReturnType<typeof makeMockEmbedding>;
  let indexingService: IndexingService;

  beforeEach(async () => {
    vi.clearAllMocks();

    searchService = makeMockSearch();
    cosmosClient = makeMockCosmos();
    gremlinClient = makeMockGremlin();
    embeddingService = makeMockEmbedding();

    indexingService = new IndexingService(
      searchService as unknown as SearchClientWrapper,
      cosmosClient as unknown as CosmosNoSqlClient,
      gremlinClient as unknown as CosmosGremlinClient,
      embeddingService as unknown as EmbeddingService,
    );
  });

  describe('processInterview', () => {
    it('should chunk transcript, extract entities, and index all chunks', async () => {
      const result = await indexingService.processInterview(
        sampleInterviewTranscript,
        'session-001',
        'retiree-001',
      );

      // Should produce multiple chunks
      expect(result.chunks.length).toBeGreaterThan(0);

      // Should extract entities
      expect(result.entities.length).toBeGreaterThan(0);

      // Each chunk should have been indexed in search
      expect(searchService.indexChunk).toHaveBeenCalledTimes(result.chunks.length);

      // Each chunk should have been stored in Cosmos DB
      expect(cosmosClient.upsert).toHaveBeenCalledTimes(result.chunks.length);

      // Entities should have been merged into the graph
      expect(gremlinClient.query).toHaveBeenCalled();
    });

    it('should assign quality scores to all chunks', async () => {
      const result = await indexingService.processInterview(
        sampleInterviewTranscript,
        'session-002',
        'retiree-001',
      );

      for (const chunk of result.chunks) {
        expect(chunk.qualityScore).toBeDefined();
        expect(chunk.qualityScore.overall).toBeGreaterThanOrEqual(0);
        expect(chunk.qualityScore.overall).toBeLessThanOrEqual(1);
      }
    });

    it('should set correct metadata on chunks', async () => {
      const result = await indexingService.processInterview(
        sampleInterviewTranscript,
        'session-003',
        'retiree-001',
      );

      for (const chunk of result.chunks) {
        expect(chunk.retireeId).toBe('retiree-001');
        expect(chunk.source.type).toBe('interview');
        expect(chunk.source.sourceId).toBe('session-003');
        expect(chunk.knowledgeType).toBe('tacit');
        expect(chunk.consentId).toBe('retiree-001');
        expect(chunk.id).toBeTruthy();
      }
    });

    it('should generate embeddings for each chunk', async () => {
      const result = await indexingService.processInterview(
        sampleInterviewTranscript,
        'session-004',
        'retiree-001',
      );

      // embed() should be called at least once per chunk (for content embedding)
      expect(embeddingService.embed).toHaveBeenCalledTimes(result.chunks.length);
    });
  });

  describe('entity deduplication', () => {
    it('should call gremlin query for entity lookup during processing', async () => {
      await indexingService.processInterview(
        sampleInterviewTranscript,
        'session-005',
        'retiree-001',
      );

      // gremlinClient.query should be called for entity lookup (findEntity)
      // and potentially for mergeEntity operations
      expect(gremlinClient.query).toHaveBeenCalled();
    });

    it('should handle entities appearing in multiple chunks', async () => {
      // Process same transcript twice to simulate overlapping entities
      const result1 = await indexingService.processInterview(
        sampleInterviewTranscript,
        'session-006a',
        'retiree-001',
      );

      const result2 = await indexingService.processInterview(
        sampleInterviewTranscript,
        'session-006b',
        'retiree-001',
      );

      // Both should succeed without errors
      expect(result1.chunks.length).toBeGreaterThan(0);
      expect(result2.chunks.length).toBeGreaterThan(0);

      // Gremlin should have been called for entity merging both times
      expect(gremlinClient.query).toHaveBeenCalled();
    });
  });
});
