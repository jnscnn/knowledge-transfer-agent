import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/shared/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ResultReranker } from '../../../../src/agents/query/reranker.js';
import type { RankedResults } from '../../../../src/agents/query/reranker.js';
import type { RetrievalResults, VectorResult, GraphResult } from '../../../../src/agents/query/retriever.js';
import type { KnowledgeChunk, Entity, RewrittenQuery } from '../../../../src/shared/types.js';

function makeChunk(id: string, content = 'test content'): KnowledgeChunk {
  const now = new Date();
  return {
    id,
    content,
    summary: content.slice(0, 50),
    knowledgeType: 'tacit',
    domainId: 'test',
    retireeId: 'retiree-001',
    source: { type: 'interview', sourceId: 'session-1', timestamp: now },
    entities: [],
    qualityScore: { overall: 0.8, completeness: 0.8, specificity: 0.8, uniqueness: 0.7, actionability: 0.7, recency: 0.7 },
    sensitivityLevel: 'internal',
    consentId: 'consent-001',
    createdAt: now,
    updatedAt: now,
  };
}

function makeEntity(id: string, name: string): Entity {
  const now = new Date();
  return {
    id,
    type: 'System',
    name,
    aliases: [],
    description: '',
    properties: {},
    mentionCount: 1,
    domains: [],
    firstSeen: now,
    lastSeen: now,
  };
}

const dummyQuery: RewrittenQuery = {
  vectorQuery: 'test query',
  keywordQuery: 'test',
  filters: {},
};

describe('ResultReranker', () => {
  const reranker = new ResultReranker();

  describe('RRF score calculation', () => {
    it('should assign higher score to higher-ranked results', () => {
      const results: RetrievalResults = {
        vectorResults: [
          { chunk: makeChunk('c1'), score: 0.9, source: 'content_vector' },
          { chunk: makeChunk('c2'), score: 0.5, source: 'content_vector' },
        ],
        graphResults: [],
      };

      const ranked = reranker.rerank(results, dummyQuery);

      expect(ranked.items.length).toBe(2);
      // Higher original score should yield higher RRF score
      const c1 = ranked.items.find((i) => i.chunk?.id === 'c1');
      const c2 = ranked.items.find((i) => i.chunk?.id === 'c2');
      expect(c1).toBeDefined();
      expect(c2).toBeDefined();
      expect(c1!.combinedScore).toBeGreaterThan(c2!.combinedScore);
    });

    it('should compute RRF contribution as 1/(k+rank+1) with k=60', () => {
      const results: RetrievalResults = {
        vectorResults: [
          { chunk: makeChunk('c1'), score: 0.9, source: 'content_vector' },
        ],
        graphResults: [],
      };

      const ranked = reranker.rerank(results, dummyQuery);

      // Rank 0, k=60: RRF = 1/(60+0+1) = 1/61
      const expectedRRF = 1 / 61;
      const c1 = ranked.items.find((i) => i.chunk?.id === 'c1');
      expect(c1).toBeDefined();
      expect(c1!.combinedScore).toBeCloseTo(expectedRRF, 5);
    });
  });

  describe('corroboration boost', () => {
    it('should boost score when chunk appears in multiple source types', () => {
      // Same chunk from content_vector and keyword source
      const chunk = makeChunk('c1');
      const results: RetrievalResults = {
        vectorResults: [
          { chunk, score: 0.9, source: 'content_vector' },
          { chunk, score: 0.8, source: 'keyword' },
        ],
        graphResults: [],
      };

      const ranked = reranker.rerank(results, dummyQuery);

      const c1 = ranked.items.find((i) => i.chunk?.id === 'c1');
      expect(c1).toBeDefined();
      expect(c1!.sources.length).toBeGreaterThan(1);

      // Compare with single-source score
      const singleSourceResults: RetrievalResults = {
        vectorResults: [{ chunk, score: 0.9, source: 'content_vector' }],
        graphResults: [],
      };
      const singleRanked = reranker.rerank(singleSourceResults, dummyQuery);
      const singleC1 = singleRanked.items.find((i) => i.chunk?.id === 'c1');

      // Multi-source should have higher combined score
      expect(c1!.combinedScore).toBeGreaterThan(singleC1!.combinedScore);
    });
  });

  describe('source diversity', () => {
    it('should calculate source diversity based on unique source types', () => {
      const results: RetrievalResults = {
        vectorResults: [
          { chunk: makeChunk('c1'), score: 0.9, source: 'content_vector' },
          { chunk: makeChunk('c2'), score: 0.7, source: 'keyword' },
        ],
        graphResults: [
          { entity: makeEntity('e1', 'TestEntity'), relationships: [], relevance: 0.8 },
        ],
      };

      const ranked = reranker.rerank(results, dummyQuery);

      // Diversity should be > 0 when multiple source types contribute
      expect(ranked.sourceDiversity).toBeGreaterThan(0);
      expect(ranked.totalSources).toBeGreaterThan(0);
    });

    it('should have lower diversity with only one source type', () => {
      const results: RetrievalResults = {
        vectorResults: [
          { chunk: makeChunk('c1'), score: 0.9, source: 'content_vector' },
          { chunk: makeChunk('c2'), score: 0.7, source: 'content_vector' },
        ],
        graphResults: [],
      };

      const ranked = reranker.rerank(results, dummyQuery);

      // Only content_vector source → diversity = 1/4 = 0.25
      expect(ranked.sourceDiversity).toBeLessThanOrEqual(0.5);
    });
  });

  describe('graph results', () => {
    it('should include graph entities in ranked results', () => {
      const results: RetrievalResults = {
        vectorResults: [],
        graphResults: [
          { entity: makeEntity('e1', 'Acme Corp'), relationships: [], relevance: 0.8 },
          { entity: makeEntity('e2', 'Sarah Chen'), relationships: [], relevance: 0.6 },
        ],
      };

      const ranked = reranker.rerank(results, dummyQuery);

      expect(ranked.items.length).toBe(2);
      expect(ranked.items[0].entity).toBeDefined();
      expect(ranked.items[0].sources).toContain('graph');
    });
  });

  describe('empty results handling', () => {
    it('should return empty items array for empty input', () => {
      const results: RetrievalResults = {
        vectorResults: [],
        graphResults: [],
      };

      const ranked = reranker.rerank(results, dummyQuery);

      expect(ranked.items).toEqual([]);
      expect(ranked.totalSources).toBe(0);
    });

    it('should handle vector-only results', () => {
      const results: RetrievalResults = {
        vectorResults: [
          { chunk: makeChunk('c1'), score: 0.9, source: 'content_vector' },
        ],
        graphResults: [],
      };

      const ranked = reranker.rerank(results, dummyQuery);

      expect(ranked.items.length).toBe(1);
      expect(ranked.items[0].chunk?.id).toBe('c1');
    });

    it('should handle graph-only results', () => {
      const results: RetrievalResults = {
        vectorResults: [],
        graphResults: [
          { entity: makeEntity('e1', 'Test'), relationships: [], relevance: 0.5 },
        ],
      };

      const ranked = reranker.rerank(results, dummyQuery);

      expect(ranked.items.length).toBe(1);
      expect(ranked.items[0].entity?.name).toBe('Test');
    });
  });
});
