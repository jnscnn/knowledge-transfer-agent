import { logger } from '../../shared/logger.js';
import { withRetry } from '../../shared/retry.js';
import type { KnowledgeChunk, Entity, EntityRelationship, RewrittenQuery } from '../../shared/types.js';
import type { SearchClientWrapper, SearchResult } from '../../storage/search-client.js';
import type { CosmosGremlinClient, VertexResult, EdgeResult } from '../../storage/cosmos-gremlin-client.js';
import type { EmbeddingService } from '../../pipeline/embedding.js';

// ── Result types ──

export interface VectorResult {
  chunk: KnowledgeChunk;
  score: number;
  source: 'content_vector' | 'hyde_vector' | 'keyword';
}

export interface GraphResult {
  entity: Entity;
  relationships: EntityRelationship[];
  relevance: number;
}

export interface RetrievalResults {
  vectorResults: VectorResult[];
  graphResults: GraphResult[];
}

// ── Helpers ──

function searchDocToChunk(doc: SearchResult): VectorResult {
  const d = doc.document;
  const chunk: KnowledgeChunk = {
    id: d.id,
    content: d.content,
    summary: d.summary,
    knowledgeType: d.knowledge_type as KnowledgeChunk['knowledgeType'],
    domainId: d.knowledge_domain,
    retireeId: d.retiree_id,
    source: {
      type: d.source_type as KnowledgeChunk['source']['type'],
      sourceId: d.id,
      timestamp: new Date(d.timestamp),
    },
    entities: d.entities.map((e) => {
      const [type, ...rest] = e.split(':');
      return {
        entityId: '',
        text: rest.join(':'),
        type: (type ?? 'System') as KnowledgeChunk['entities'][number]['type'],
        confidence: 1,
      };
    }),
    qualityScore: {
      overall: d.quality_score,
      completeness: 0,
      specificity: 0,
      uniqueness: 0,
      actionability: 0,
      recency: 0,
    },
    sensitivityLevel: d.sensitivity_level as KnowledgeChunk['sensitivityLevel'],
    consentId: d.consent_id ?? '',
    createdAt: new Date(d.timestamp),
    updatedAt: new Date(d.timestamp),
  };
  return { chunk, score: doc.rerankerScore ?? doc.score, source: 'content_vector' };
}

function vertexToEntity(v: VertexResult): Entity {
  const props = v.properties as Record<string, unknown>;
  return {
    id: v.id,
    type: (v.label ?? 'System') as Entity['type'],
    name: String(props['name'] ?? v.id),
    aliases: Array.isArray(props['aliases']) ? props['aliases'] as string[] : [],
    description: String(props['description'] ?? ''),
    properties: props,
    mentionCount: Number(props['mentionCount'] ?? 0),
    domains: Array.isArray(props['domains']) ? props['domains'] as string[] : [],
    firstSeen: props['firstSeen'] ? new Date(String(props['firstSeen'])) : new Date(),
    lastSeen: props['lastSeen'] ? new Date(String(props['lastSeen'])) : new Date(),
  };
}

function edgeToRelationship(e: EdgeResult): EntityRelationship {
  return {
    id: e.id,
    sourceEntityId: e.outV,
    targetEntityId: e.inV,
    relationshipType: e.label as EntityRelationship['relationshipType'],
    properties: e.properties,
    evidence: [],
    firstObserved: new Date(),
    lastObserved: new Date(),
  };
}

function buildODataFilter(query: RewrittenQuery): string | undefined {
  const parts: string[] = [];
  const f = query.filters;

  if (f.domains && f.domains.length > 0) {
    const domainFilters = f.domains.map((d) => `knowledge_domain eq '${d}'`);
    parts.push(`(${domainFilters.join(' or ')})`);
  }

  if (f.retireeIds && f.retireeIds.length > 0) {
    const retireeFilters = f.retireeIds.map((r) => `retiree_id eq '${r}'`);
    parts.push(`(${retireeFilters.join(' or ')})`);
  }

  if (f.sensitivityLevels && f.sensitivityLevels.length > 0) {
    const sensFilters = f.sensitivityLevels.map((s) => `sensitivity_level eq '${s}'`);
    parts.push(`(${sensFilters.join(' or ')})`);
  }

  if (f.minQualityScore !== undefined) {
    parts.push(`quality_score ge ${f.minQualityScore}`);
  }

  return parts.length > 0 ? parts.join(' and ') : undefined;
}

// ── Retriever ──

export class MultiSourceRetriever {
  constructor(
    private searchService: SearchClientWrapper,
    private gremlinClient: CosmosGremlinClient,
    private embeddingService: EmbeddingService,
  ) {}

  async retrieve(query: RewrittenQuery): Promise<RetrievalResults> {
    const startMs = Date.now();
    logger.info('Starting multi-source retrieval', {
      component: 'MultiSourceRetriever',
      hasGraphQuery: String(!!query.graphQuery),
    });

    const filter = buildODataFilter(query);

    // Build parallel retrieval tasks
    const tasks: Array<Promise<void>> = [];
    let contentResults: SearchResult[] = [];
    let hydeResults: SearchResult[] = [];
    let graphResults: GraphResult[] = [];

    // 1. Hybrid search (vector + keyword + semantic reranking) with content_vector
    tasks.push(
      this.hybridSearch(query.vectorQuery, query.keywordQuery, filter)
        .then((r) => { contentResults = r; }),
    );

    // 2. HyDE vector search (if exploratory/factual intent, generate HyDE embedding)
    tasks.push(
      this.hydeSearch(query.vectorQuery, filter)
        .then((r) => { hydeResults = r; }),
    );

    // 3. Graph traversal (if graphQuery is present)
    if (query.graphQuery) {
      tasks.push(
        this.graphTraversal(query)
          .then((r) => { graphResults = r; }),
      );
    }

    await Promise.all(tasks);

    // Convert search results to VectorResults
    const vectorResults: VectorResult[] = [];

    for (const sr of contentResults) {
      const vr = searchDocToChunk(sr);
      vr.source = 'content_vector';
      vectorResults.push(vr);
    }

    for (const sr of hydeResults) {
      // Avoid duplicates from HyDE search
      if (!vectorResults.some((v) => v.chunk.id === sr.document.id)) {
        const vr = searchDocToChunk(sr);
        vr.source = 'hyde_vector';
        vectorResults.push(vr);
      }
    }

    logger.info('Multi-source retrieval complete', {
      component: 'MultiSourceRetriever',
      contentResults: String(contentResults.length),
      hydeResults: String(hydeResults.length),
      graphResults: String(graphResults.length),
      vectorResultsTotal: String(vectorResults.length),
      durationMs: String(Date.now() - startMs),
    });

    return { vectorResults, graphResults };
  }

  private async hybridSearch(
    vectorQuery: string,
    keywordQuery: string,
    filter: string | undefined,
  ): Promise<SearchResult[]> {
    return withRetry(
      async () => {
        const queryVector = await this.embeddingService.embed(vectorQuery);
        return this.searchService.search({
          query: keywordQuery,
          vector: queryVector,
          filter,
          top: 10,
          semanticConfiguration: 'default',
        });
      },
      { maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 10_000, jitter: true },
    );
  }

  private async hydeSearch(
    question: string,
    filter: string | undefined,
  ): Promise<SearchResult[]> {
    try {
      const hydeVector = await this.embeddingService.embedWithHyde(question);
      return await this.searchService.search({
        query: question,
        hydeVector,
        filter,
        top: 5,
      });
    } catch (error) {
      logger.warn('HyDE search failed, continuing without', {
        component: 'MultiSourceRetriever',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async graphTraversal(query: RewrittenQuery): Promise<GraphResult[]> {
    try {
      const results: GraphResult[] = [];

      // Extract entity names from filters to search the graph
      const entityNames = query.filters.domains ?? [];
      if (query.graphQuery) {
        // Use keyword query terms as potential entity identifiers
        const terms = query.keywordQuery.split(/\s+/).filter((t) => t.length > 2);
        entityNames.push(...terms);
      }

      for (const name of entityNames.slice(0, 5)) {
        // Search for vertices matching the entity name
        const queryStr = `g.V().has('name', name).limit(3)`;
        const rawVertices = await this.gremlinClient.query(queryStr, { name });

        for (const raw of rawVertices) {
          const vertex = raw as VertexResult;
          const entity = vertexToEntity(vertex);

          // Get relationships for this entity
          const edgeQuery = `g.V(id).bothE().limit(10)`;
          const rawEdges = await this.gremlinClient.query(edgeQuery, { id: vertex.id });
          const relationships = rawEdges.map((e) => edgeToRelationship(e as EdgeResult));

          results.push({
            entity,
            relationships,
            relevance: 0.5,
          });
        }
      }

      return results;
    } catch (error) {
      logger.warn('Graph traversal failed, continuing without', {
        component: 'MultiSourceRetriever',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
