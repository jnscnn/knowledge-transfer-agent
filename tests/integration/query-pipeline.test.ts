import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => {
  const mockChatCreate = vi.fn();
  return {
    AzureOpenAI: vi.fn().mockImplementation(() => ({
      chat: {
        completions: { create: mockChatCreate },
      },
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: new Array(3072).fill(0.1) }],
        }),
      },
    })),
    _mockChatCreate: mockChatCreate,
  };
});

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn(),
  getBearerTokenProvider: vi.fn(() => vi.fn()),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'query-uuid-001'),
}));

vi.mock('../../src/shared/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ResultReranker } from '../../src/agents/query/reranker.js';
import { QueryGuardrails } from '../../src/agents/query/guardrails.js';
import type { RetrievalResults, VectorResult } from '../../src/agents/query/retriever.js';
import type { CosmosNoSqlClient } from '../../src/storage/cosmos-nosql-client.js';
import type { KnowledgeChunk, RewrittenQuery, AgentResponse } from '../../src/shared/types.js';
import { sampleChunks, sampleEntities, sampleAgentResponse } from '../fixtures/sample-knowledge.js';

function makeMockCosmos(sensitivityLevel = 'confidential'): CosmosNoSqlClient {
  return {
    query: vi.fn().mockResolvedValue([{ sensitivityLevelAllowed: sensitivityLevel }]),
    upsert: vi.fn().mockResolvedValue({}),
  } as unknown as CosmosNoSqlClient;
}

function makeVectorResult(chunk: KnowledgeChunk, score: number, source: VectorResult['source'] = 'content_vector'): VectorResult {
  return { chunk, score, source };
}

describe('Query Pipeline Integration', () => {
  let reranker: ResultReranker;
  let guardrails: QueryGuardrails;
  let cosmosClient: ReturnType<typeof makeMockCosmos>;

  beforeEach(() => {
    vi.clearAllMocks();
    reranker = new ResultReranker();
    cosmosClient = makeMockCosmos('confidential');
    guardrails = new QueryGuardrails(cosmosClient as unknown as CosmosNoSqlClient);
  });

  describe('full query flow: question → answer with citations', () => {
    it('should rank, filter, and validate results from a simulated query', async () => {
      // Simulate retrieval results
      const retrievalResults: RetrievalResults = {
        vectorResults: [
          makeVectorResult(sampleChunks[0], 0.92), // Acme Corp overview (internal)
          makeVectorResult(sampleChunks[1], 0.88), // Negotiation (confidential)
          makeVectorResult(sampleChunks[4], 0.75), // Supply chain (internal)
        ],
        graphResults: [
          {
            entity: sampleEntities[0], // Acme Corp entity
            relationships: [],
            relevance: 0.85,
          },
        ],
      };

      const query: RewrittenQuery = {
        vectorQuery: 'Who should I contact at Acme Corp for quality issues?',
        keywordQuery: 'Acme Corp quality contact escalation',
        filters: { domains: ['vendor-management'] },
      };

      // Step 1: Rerank
      const ranked = reranker.rerank(retrievalResults, query);
      expect(ranked.items.length).toBeGreaterThan(0);

      // Step 2: Filter by access (user has confidential access)
      const filtered = await guardrails.filterByAccess(ranked, 'user-001');
      expect(filtered.items.length).toBeGreaterThan(0);

      // All items should be at or below confidential level
      for (const item of filtered.items) {
        if (item.chunk) {
          const level = item.chunk.sensitivityLevel;
          expect(['public', 'internal', 'confidential']).toContain(level);
        }
      }

      // Step 3: Validate a simulated response
      const response: AgentResponse = {
        ...sampleAgentResponse,
        sources: filtered.items
          .filter((i) => i.chunk)
          .map((i) => ({
            type: 'interview' as const,
            sourceId: i.chunk!.id,
            title: `Chunk ${i.chunk!.id}`,
            relevance: i.combinedScore,
            timestamp: new Date(),
            retiree: 'Robert Thompson',
          })),
      };

      const validation = guardrails.validateResponse(response);
      expect(validation.valid).toBe(true);
    });
  });

  describe('query with graph results merged with vector results', () => {
    it('should merge graph and vector results with proper scoring', () => {
      const retrievalResults: RetrievalResults = {
        vectorResults: [
          makeVectorResult(sampleChunks[0], 0.9),
          makeVectorResult(sampleChunks[3], 0.7),
        ],
        graphResults: [
          {
            entity: sampleEntities[0], // Acme Corp
            relationships: [],
            relevance: 0.85,
          },
          {
            entity: sampleEntities[2], // TechStar
            relationships: [],
            relevance: 0.6,
          },
        ],
      };

      const query: RewrittenQuery = {
        vectorQuery: 'vendor relationships',
        keywordQuery: 'vendor',
        graphQuery: 'g.V().has("type", "Vendor")',
        filters: {},
      };

      const ranked = reranker.rerank(retrievalResults, query);

      // Should contain both vector and graph results
      const hasChunks = ranked.items.some((i) => i.chunk !== undefined);
      const hasEntities = ranked.items.some((i) => i.entity !== undefined);
      expect(hasChunks).toBe(true);
      expect(hasEntities).toBe(true);

      // Source diversity should reflect multiple source types
      expect(ranked.sourceDiversity).toBeGreaterThan(0);
    });
  });

  describe('access control filtering', () => {
    it('should filter highly confidential chunks for internal users', async () => {
      const internalCosmos = makeMockCosmos('internal');
      const internalGuardrails = new QueryGuardrails(internalCosmos as unknown as CosmosNoSqlClient);

      const retrievalResults: RetrievalResults = {
        vectorResults: [
          makeVectorResult(sampleChunks[0], 0.9),  // internal
          makeVectorResult(sampleChunks[1], 0.85),  // confidential
          makeVectorResult(sampleChunks[7], 0.8),   // highly_confidential
        ],
        graphResults: [],
      };

      const query: RewrittenQuery = {
        vectorQuery: 'test query',
        keywordQuery: 'test',
        filters: {},
      };

      const ranked = reranker.rerank(retrievalResults, query);
      const filtered = await internalGuardrails.filterByAccess(ranked, 'internal-user');

      // Should keep internal, remove confidential and highly_confidential
      for (const item of filtered.items) {
        if (item.chunk) {
          expect(item.chunk.sensitivityLevel).toBe('internal');
        }
      }
    });

    it('should allow all chunks for highly_confidential users', async () => {
      const hcCosmos = makeMockCosmos('highly_confidential');
      const hcGuardrails = new QueryGuardrails(hcCosmos as unknown as CosmosNoSqlClient);

      const retrievalResults: RetrievalResults = {
        vectorResults: sampleChunks.slice(0, 5).map((c, i) =>
          makeVectorResult(c, 0.9 - i * 0.1),
        ),
        graphResults: [],
      };

      const query: RewrittenQuery = {
        vectorQuery: 'all chunks',
        keywordQuery: 'all',
        filters: {},
      };

      const ranked = reranker.rerank(retrievalResults, query);
      const filtered = await hcGuardrails.filterByAccess(ranked, 'admin-user');

      // Should keep all chunks
      expect(filtered.items.length).toBe(ranked.items.length);
    });

    it('should block low-confidence responses during validation', () => {
      const response: AgentResponse = {
        queryId: 'q-lowconf',
        answer: 'I am not sure about this.',
        confidence: 0.05,
        sources: [],
        coverage: 'insufficient',
        followUps: [],
        processingTimeMs: 200,
      };

      const validation = guardrails.validateResponse(response);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Insufficient data');
    });
  });
});
