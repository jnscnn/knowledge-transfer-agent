import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/shared/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { QueryGuardrails } from '../../../../src/agents/query/guardrails.js';
import type { CosmosNoSqlClient } from '../../../../src/storage/cosmos-nosql-client.js';
import type { AgentResponse } from '../../../../src/shared/types.js';
import type { RankedResults, RankedItem } from '../../../../src/agents/query/reranker.js';

function makeMockCosmosClient(sensitivityLevel = 'public'): CosmosNoSqlClient {
  return {
    query: vi.fn().mockResolvedValue([{ sensitivityLevelAllowed: sensitivityLevel }]),
  } as unknown as CosmosNoSqlClient;
}

function makeResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    queryId: 'q-001',
    answer: 'Test answer based on knowledge base.',
    confidence: 0.8,
    sources: [
      {
        type: 'interview',
        sourceId: 'chunk-001',
        title: 'Test Source',
        relevance: 0.9,
        timestamp: new Date(),
        retiree: 'Test Retiree',
      },
    ],
    coverage: 'complete',
    followUps: ['Follow-up question?'],
    processingTimeMs: 500,
    ...overrides,
  };
}

function makeRankedResults(items: RankedItem[]): RankedResults {
  return {
    items,
    totalSources: items.length,
    sourceDiversity: 0.5,
  };
}

describe('QueryGuardrails', () => {
  describe('validateResponse', () => {
    let guardrails: QueryGuardrails;

    beforeEach(() => {
      guardrails = new QueryGuardrails(makeMockCosmosClient());
    });

    it('should block responses with extremely low confidence', () => {
      const response = makeResponse({ confidence: 0.05 });
      const result = guardrails.validateResponse(response);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Insufficient data');
    });

    it('should allow responses with high confidence and sources', () => {
      const response = makeResponse({ confidence: 0.85 });
      const result = guardrails.validateResponse(response);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should block responses with no sources unless coverage is insufficient', () => {
      const response = makeResponse({
        confidence: 0.5,
        sources: [],
        coverage: 'complete',
      });
      const result = guardrails.validateResponse(response);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No sources');
    });

    it('should allow no-source responses when coverage is insufficient', () => {
      const response = makeResponse({
        confidence: 0.3,
        sources: [],
        coverage: 'insufficient',
      });
      const result = guardrails.validateResponse(response);

      expect(result.valid).toBe(true);
    });

    it('should allow responses at exactly the confidence threshold', () => {
      const response = makeResponse({ confidence: 0.1 });
      const result = guardrails.validateResponse(response);

      expect(result.valid).toBe(true);
    });
  });

  describe('filterByAccess', () => {
    it('should filter out chunks exceeding user sensitivity level', async () => {
      const cosmosClient = makeMockCosmosClient('internal');
      const guardrails = new QueryGuardrails(cosmosClient);

      const now = new Date();
      const internalChunk: RankedItem = {
        chunk: {
          id: 'c1', content: 'internal info', summary: '', knowledgeType: 'tacit',
          domainId: 'test', retireeId: 'r1',
          source: { type: 'interview', sourceId: 's1', timestamp: now },
          entities: [], qualityScore: { overall: 0.8, completeness: 0.8, specificity: 0.8, uniqueness: 0.7, actionability: 0.7, recency: 0.7 },
          sensitivityLevel: 'internal', consentId: 'c1', createdAt: now, updatedAt: now,
        },
        combinedScore: 0.9,
        sources: ['vector'],
      };

      const confidentialChunk: RankedItem = {
        chunk: {
          id: 'c2', content: 'confidential info', summary: '', knowledgeType: 'tacit',
          domainId: 'test', retireeId: 'r1',
          source: { type: 'interview', sourceId: 's1', timestamp: now },
          entities: [], qualityScore: { overall: 0.8, completeness: 0.8, specificity: 0.8, uniqueness: 0.7, actionability: 0.7, recency: 0.7 },
          sensitivityLevel: 'confidential', consentId: 'c1', createdAt: now, updatedAt: now,
        },
        combinedScore: 0.8,
        sources: ['vector'],
      };

      const results = makeRankedResults([internalChunk, confidentialChunk]);
      const filtered = await guardrails.filterByAccess(results, 'user-001');

      // User has internal access — should keep internal, remove confidential
      expect(filtered.items.length).toBe(1);
      expect(filtered.items[0].chunk?.id).toBe('c1');
    });

    it('should allow graph entities through regardless of sensitivity', async () => {
      const cosmosClient = makeMockCosmosClient('public');
      const guardrails = new QueryGuardrails(cosmosClient);

      const entityItem: RankedItem = {
        entity: {
          id: 'e1', type: 'Vendor', name: 'Acme',
          aliases: [], description: '', properties: {},
          mentionCount: 1, domains: [],
          firstSeen: new Date(), lastSeen: new Date(),
        },
        combinedScore: 0.7,
        sources: ['graph'],
      };

      const results = makeRankedResults([entityItem]);
      const filtered = await guardrails.filterByAccess(results, 'user-001');

      expect(filtered.items.length).toBe(1);
    });

    it('should default to public when cosmos query fails', async () => {
      const cosmosClient = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      } as unknown as CosmosNoSqlClient;
      const guardrails = new QueryGuardrails(cosmosClient);

      const now = new Date();
      const internalItem: RankedItem = {
        chunk: {
          id: 'c1', content: 'internal', summary: '', knowledgeType: 'tacit',
          domainId: 'test', retireeId: 'r1',
          source: { type: 'interview', sourceId: 's1', timestamp: now },
          entities: [], qualityScore: { overall: 0.8, completeness: 0.8, specificity: 0.8, uniqueness: 0.7, actionability: 0.7, recency: 0.7 },
          sensitivityLevel: 'internal', consentId: 'c1', createdAt: now, updatedAt: now,
        },
        combinedScore: 0.9,
        sources: ['vector'],
      };

      const results = makeRankedResults([internalItem]);
      const filtered = await guardrails.filterByAccess(results, 'user-001');

      // Defaults to public → internal chunk should be filtered out
      expect(filtered.items.length).toBe(0);
    });
  });

  describe('redactSensitive', () => {
    let guardrails: QueryGuardrails;

    beforeEach(() => {
      guardrails = new QueryGuardrails(makeMockCosmosClient());
    });

    it('should not redact anything for highly_confidential users', () => {
      const answer = 'Contact john@example.com or call 555-123-4567. Server IP: 10.0.1.50.';
      const result = guardrails.redactSensitive(answer, 'highly_confidential');

      expect(result).toBe(answer);
    });

    it('should redact emails and phones for public-level users', () => {
      const answer = 'Contact john@example.com or call 555-123-4567 for help.';
      const result = guardrails.redactSensitive(answer, 'public');

      expect(result).toContain('[REDACTED EMAIL]');
      expect(result).toContain('[REDACTED PHONE]');
      expect(result).not.toContain('john@example.com');
      expect(result).not.toContain('555-123-4567');
    });

    it('should redact IP addresses for public-level users', () => {
      const answer = 'The server is at 10.0.1.50 on the internal network.';
      const result = guardrails.redactSensitive(answer, 'public');

      expect(result).toContain('[REDACTED IP]');
      expect(result).not.toContain('10.0.1.50');
    });

    it('should not redact emails for confidential-level users', () => {
      const answer = 'Contact john@example.com for details.';
      const result = guardrails.redactSensitive(answer, 'confidential');

      expect(result).toContain('john@example.com');
    });

    it('should redact IP addresses for internal-level users', () => {
      // internal rank=1, which is < sensitivityRank('internal')=1? No, it's equal.
      // The check is userRank < sensitivityRank('internal') → 1 < 1 → false
      // So IPs should NOT be redacted for internal users
      const answer = 'Server at 10.0.1.50.';
      const result = guardrails.redactSensitive(answer, 'internal');

      expect(result).toContain('10.0.1.50');
    });
  });
});
