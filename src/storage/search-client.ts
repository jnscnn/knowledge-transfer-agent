import {
  SearchClient,
  SearchIndexClient,
  AzureKeyCredential,
  type SearchOptions,
  type VectorizedQuery,
  type SemanticSearchOptions,
} from '@azure/search-documents';
import { logger } from '../shared/logger.js';
import { SearchError, EntityNotFoundError } from '../shared/errors.js';
import type { KnowledgeChunk } from '../shared/types.js';

export interface SearchDocument {
  id: string;
  content: string;
  summary: string;
  source_type: string;
  retiree_id: string;
  knowledge_domain: string;
  knowledge_type: string;
  sensitivity_level: string;
  consent_id: string;
  entities: string[];
  quality_score: number;
  timestamp: string;
  content_vector?: number[];
  hyde_vector?: number[];
}

export interface HybridSearchOptions {
  query: string;
  vector?: number[];
  hydeVector?: number[];
  filter?: string;
  top?: number;
  select?: string[];
  semanticConfiguration?: string;
}

export interface SearchResult {
  id: string;
  score: number;
  rerankerScore?: number;
  document: SearchDocument;
}

type SearchDocFields = Extract<keyof SearchDocument, string>;

export class SearchClientWrapper {
  private searchClient: SearchClient<SearchDocument>;
  private indexClient: SearchIndexClient;
  private indexName: string;

  constructor(endpoint: string, apiKey: string, indexName: string = 'knowledge-chunks') {
    const credential = new AzureKeyCredential(apiKey);
    this.indexName = indexName;
    this.searchClient = new SearchClient<SearchDocument>(endpoint, indexName, credential);
    this.indexClient = new SearchIndexClient(endpoint, credential);
  }

  async indexChunk(chunk: KnowledgeChunk, vectors?: { content?: number[]; hyde?: number[] }): Promise<void> {
    try {
      const doc: SearchDocument = {
        id: chunk.id,
        content: chunk.content,
        summary: chunk.summary,
        source_type: chunk.source.type,
        retiree_id: chunk.retireeId,
        knowledge_domain: chunk.domainId,
        knowledge_type: chunk.knowledgeType,
        sensitivity_level: chunk.sensitivityLevel,
        consent_id: chunk.consentId,
        entities: chunk.entities.map((e) => `${e.type}:${e.text}`),
        quality_score: chunk.qualityScore.overall,
        timestamp: chunk.createdAt.toISOString(),
        content_vector: vectors?.content,
        hyde_vector: vectors?.hyde,
      };

      await this.searchClient.mergeOrUploadDocuments([doc]);
      logger.info('Indexed knowledge chunk', {
        component: 'SearchClient',
        operation: 'indexChunk',
        chunkId: chunk.id,
      });
    } catch (error) {
      throw new SearchError(
        `Failed to index chunk ${chunk.id}: ${error instanceof Error ? error.message : String(error)}`,
        { chunkId: chunk.id },
      );
    }
  }

  async search(options: HybridSearchOptions): Promise<SearchResult[]> {
    try {
      const selectFields: SearchDocFields[] = [
        'id', 'content', 'summary', 'source_type', 'retiree_id',
        'knowledge_domain', 'knowledge_type', 'sensitivity_level',
        'entities', 'quality_score', 'timestamp',
      ];

      // Build vector queries
      const vectorQueries: VectorizedQuery<SearchDocument>[] = [];

      if (options.vector) {
        vectorQueries.push({
          kind: 'vector',
          vector: options.vector,
          kNearestNeighborsCount: options.top ?? 10,
          fields: ['content_vector' as SearchDocFields],
        });
      }
      if (options.hydeVector) {
        vectorQueries.push({
          kind: 'vector',
          vector: options.hydeVector,
          kNearestNeighborsCount: options.top ?? 10,
          fields: ['hyde_vector' as SearchDocFields],
        });
      }

      const baseOptions = {
        top: options.top ?? 10,
        select: (options.select as SearchDocFields[]) ?? selectFields,
        filter: options.filter,
        vectorSearchOptions: vectorQueries.length > 0
          ? { queries: vectorQueries }
          : undefined,
      };

      let searchOptions: SearchOptions<SearchDocument>;
      if (options.semanticConfiguration) {
        searchOptions = {
          ...baseOptions,
          queryType: 'semantic' as const,
          semanticSearchOptions: {
            configurationName: options.semanticConfiguration,
          } satisfies SemanticSearchOptions,
        };
      } else {
        searchOptions = baseOptions;
      }

      const results: SearchResult[] = [];
      const response = await this.searchClient.search(options.query, searchOptions);

      for await (const result of response.results) {
        results.push({
          id: result.document.id,
          score: result.score,
          rerankerScore: result.rerankerScore,
          document: result.document,
        });
      }

      return results;
    } catch (error) {
      throw new SearchError(
        `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        { query: options.query },
      );
    }
  }

  async deleteChunk(id: string): Promise<void> {
    try {
      await this.searchClient.deleteDocuments('id', [id]);
      logger.info('Deleted chunk from search index', {
        component: 'SearchClient',
        operation: 'deleteChunk',
        chunkId: id,
      });
    } catch (error) {
      throw new SearchError(
        `Failed to delete chunk ${id}: ${error instanceof Error ? error.message : String(error)}`,
        { chunkId: id },
      );
    }
  }

  async getChunk(id: string): Promise<SearchDocument> {
    try {
      const result = await this.searchClient.getDocument(id);
      return result;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404) {
        throw new EntityNotFoundError('SearchDocument', id);
      }
      throw new SearchError(
        `Failed to get chunk ${id}: ${error instanceof Error ? error.message : String(error)}`,
        { chunkId: id },
      );
    }
  }

  /** Expose the index client for schema operations. */
  getIndexClient(): SearchIndexClient {
    return this.indexClient;
  }

  getSearchIndexName(): string {
    return this.indexName;
  }
}
