import { logger } from '../../shared/logger.js';
import type { KnowledgeChunk, Entity, RewrittenQuery } from '../../shared/types.js';
import type { RetrievalResults, VectorResult, GraphResult } from './retriever.js';

// ── Result types ──

export interface RankedItem {
  chunk?: KnowledgeChunk;
  entity?: Entity;
  combinedScore: number;
  sources: string[];
}

export interface RankedResults {
  items: RankedItem[];
  totalSources: number;
  sourceDiversity: number;
}

// ── Reciprocal Rank Fusion ──

const RRF_K = 60; // Standard RRF constant

interface ScoredItem {
  id: string;
  chunk?: KnowledgeChunk;
  entity?: Entity;
  rrfScore: number;
  sources: Set<string>;
}

export class ResultReranker {
  rerank(results: RetrievalResults, _query: RewrittenQuery): RankedResults {
    const startMs = Date.now();
    const itemMap = new Map<string, ScoredItem>();

    // Score vector results by source type
    this.addVectorRanks(results.vectorResults, 'content_vector', itemMap);
    this.addVectorRanks(
      results.vectorResults.filter((r) => r.source === 'hyde_vector'),
      'hyde_vector',
      itemMap,
    );
    this.addVectorRanks(
      results.vectorResults.filter((r) => r.source === 'keyword'),
      'keyword',
      itemMap,
    );

    // Score graph results
    this.addGraphRanks(results.graphResults, itemMap);

    // Boost corroborated items (appearing in multiple source types)
    for (const item of itemMap.values()) {
      if (item.sources.size > 1) {
        item.rrfScore *= 1.0 + 0.15 * (item.sources.size - 1);
      }
    }

    // Sort by combined score descending
    const sorted = [...itemMap.values()].sort((a, b) => b.rrfScore - a.rrfScore);

    // Compute source diversity
    const uniqueSources = new Set<string>();
    for (const item of sorted) {
      for (const src of item.sources) {
        uniqueSources.add(src);
      }
    }

    const totalSources = sorted.length;
    const sourceDiversity = uniqueSources.size / Math.max(1, 4); // Normalize to max of 4 source types

    const items: RankedItem[] = sorted.map((s) => ({
      chunk: s.chunk,
      entity: s.entity,
      combinedScore: s.rrfScore,
      sources: [...s.sources],
    }));

    logger.info('Reranking complete', {
      component: 'ResultReranker',
      inputVectorResults: String(results.vectorResults.length),
      inputGraphResults: String(results.graphResults.length),
      outputItems: String(items.length),
      sourceDiversity: String(sourceDiversity.toFixed(2)),
      durationMs: String(Date.now() - startMs),
    });

    return { items, totalSources, sourceDiversity };
  }

  private addVectorRanks(
    results: VectorResult[],
    sourceLabel: string,
    itemMap: Map<string, ScoredItem>,
  ): void {
    // Sort by score descending for rank assignment
    const sorted = [...results].sort((a, b) => b.score - a.score);

    for (let rank = 0; rank < sorted.length; rank++) {
      const vr = sorted[rank];
      const id = vr.chunk.id;
      const rrfContribution = 1 / (RRF_K + rank + 1);

      const existing = itemMap.get(id);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.sources.add(sourceLabel);
      } else {
        itemMap.set(id, {
          id,
          chunk: vr.chunk,
          rrfScore: rrfContribution,
          sources: new Set([sourceLabel]),
        });
      }
    }
  }

  private addGraphRanks(
    results: GraphResult[],
    itemMap: Map<string, ScoredItem>,
  ): void {
    // Sort by relevance descending for rank assignment
    const sorted = [...results].sort((a, b) => b.relevance - a.relevance);

    for (let rank = 0; rank < sorted.length; rank++) {
      const gr = sorted[rank];
      const id = `graph:${gr.entity.id}`;
      const rrfContribution = 1 / (RRF_K + rank + 1);

      const existing = itemMap.get(id);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.sources.add('graph');
      } else {
        itemMap.set(id, {
          id,
          entity: gr.entity,
          rrfScore: rrfContribution,
          sources: new Set(['graph']),
        });
      }
    }
  }
}
