// Write processed chunks to all storage backends and orchestrate the full pipeline

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../shared/logger.js';
import { PipelineError } from '../shared/errors.js';
import type { KnowledgeChunk, EntityMention } from '../shared/types.js';
import type { SearchClientWrapper } from '../storage/search-client.js';
import type { CosmosNoSqlClient } from '../storage/cosmos-nosql-client.js';
import type { CosmosGremlinClient } from '../storage/cosmos-gremlin-client.js';
import { TextChunker } from './chunking.js';
import { EmbeddingService } from './embedding.js';
import { EntityExtractor } from './entity-extraction.js';
import { RelationshipExtractor } from './relationship-extraction.js';
import { QualityScorer } from './quality-scoring.js';
import { SensitivityClassifier } from './sensitivity-classifier.js';

export class IndexingService {
  private searchService: SearchClientWrapper;
  private cosmosClient: CosmosNoSqlClient;
  private gremlinClient: CosmosGremlinClient;
  private embeddingService: EmbeddingService;

  constructor(
    searchService: SearchClientWrapper,
    cosmosClient: CosmosNoSqlClient,
    gremlinClient: CosmosGremlinClient,
    embeddingService: EmbeddingService,
  ) {
    this.searchService = searchService;
    this.cosmosClient = cosmosClient;
    this.gremlinClient = gremlinClient;
    this.embeddingService = embeddingService;
  }

  async indexChunk(chunk: KnowledgeChunk): Promise<void> {
    logger.info('Indexing knowledge chunk', {
      component: 'IndexingService',
      operation: 'indexChunk',
      chunkId: chunk.id,
    });

    try {
      // Generate embeddings for content
      const contentVector = await this.embeddingService.embed(chunk.content);
      const summaryVector = chunk.summary
        ? await this.embeddingService.embed(chunk.summary)
        : undefined;

      // Write to AI Search index
      await this.searchService.indexChunk(chunk, {
        content: contentVector,
        hyde: summaryVector,
      });

      // Write to Cosmos DB NoSQL
      await this.cosmosClient.upsert(
        'knowledgeChunks',
        {
          ...chunk,
          createdAt: chunk.createdAt.toISOString(),
          updatedAt: chunk.updatedAt.toISOString(),
          source: {
            ...chunk.source,
            timestamp: chunk.source.timestamp.toISOString(),
          },
          vectors: {
            contentVectorId: chunk.id + '-content',
            summaryVectorId: chunk.id + '-summary',
          },
        } as Record<string, unknown>,
        chunk.retireeId,
      );

      logger.info('Chunk indexed successfully', {
        component: 'IndexingService',
        chunkId: chunk.id,
      });
    } catch (error) {
      throw new PipelineError(
        `Failed to index chunk ${chunk.id}: ${error instanceof Error ? error.message : String(error)}`,
        { chunkId: chunk.id },
      );
    }
  }

  async processInterview(
    transcript: string,
    sessionId: string,
    retireeId: string,
  ): Promise<{
    chunks: KnowledgeChunk[];
    entities: EntityMention[];
    relationships: number;
  }> {
    logger.info('Processing interview transcript', {
      component: 'IndexingService',
      operation: 'processInterview',
      sessionId,
      retireeId,
      transcriptLength: String(transcript.length),
    });

    const chunker = new TextChunker();
    const entityExtractor = new EntityExtractor(
      this.embeddingService['client'].baseURL.replace('/openai', ''),
      'gpt-4o',
    );
    const relationshipExtractor = new RelationshipExtractor(this.gremlinClient);
    const qualityScorer = new QualityScorer();
    const sensitivityClassifier = new SensitivityClassifier(
      this.embeddingService['client'].baseURL.replace('/openai', ''),
      'gpt-4o',
    );

    try {
      // 1. Chunk the transcript
      const textChunks = chunker.chunkText(transcript, 'interview_transcript');
      logger.info('Transcript chunked', {
        component: 'IndexingService',
        chunkCount: String(textChunks.length),
      });

      const allChunks: KnowledgeChunk[] = [];
      const allEntities: EntityMention[] = [];
      let totalRelationships = 0;

      for (const textChunk of textChunks) {
        const chunkId = uuidv4();
        const now = new Date();

        // 2a. Extract entities and relationships
        const extraction = await entityExtractor.extractEntitiesAndRelationships(textChunk.content);
        allEntities.push(...extraction.entities);

        // 2b. Score quality
        const qualityScore = qualityScorer.score({
          content: textChunk.content,
          entities: extraction.entities,
          source: { type: 'interview', timestamp: now },
        });

        // 2c. Classify sensitivity
        const sensitivityLevel = await sensitivityClassifier.classify(
          textChunk.content,
          extraction.entities,
        );

        // 2d. Generate embeddings
        const contentVector = await this.embeddingService.embed(textChunk.content);

        // Build KnowledgeChunk
        const chunk: KnowledgeChunk = {
          id: chunkId,
          content: textChunk.content,
          summary: textChunk.content.slice(0, 200),
          knowledgeType: 'tacit',
          domainId: 'general',
          retireeId,
          source: {
            type: 'interview',
            sourceId: sessionId,
            timestamp: now,
          },
          entities: extraction.entities,
          qualityScore,
          sensitivityLevel,
          consentId: retireeId,
          vectors: {
            contentVectorId: chunkId + '-content',
            summaryVectorId: chunkId + '-summary',
          },
          createdAt: now,
          updatedAt: now,
        };

        // 2e. Write to AI Search index
        await this.searchService.indexChunk(chunk, { content: contentVector });

        // 2f. Write to Cosmos DB NoSQL
        await this.cosmosClient.upsert(
          'knowledgeChunks',
          {
            ...chunk,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            source: {
              ...chunk.source,
              timestamp: now.toISOString(),
            },
          } as Record<string, unknown>,
          retireeId,
        );

        // 2g. Write entities/relationships to Gremlin graph
        for (const entity of extraction.entities) {
          await relationshipExtractor.mergeEntity(entity, retireeId);
        }

        if (extraction.relationships.length > 0) {
          await relationshipExtractor.addRelationships(
            extraction.relationships.map((r) => ({ ...r, chunkId })),
            retireeId,
          );
          totalRelationships += extraction.relationships.length;
        }

        allChunks.push(chunk);
      }

      chunker.dispose();

      logger.info('Interview processing complete', {
        component: 'IndexingService',
        sessionId,
        chunkCount: String(allChunks.length),
        entityCount: String(allEntities.length),
        relationshipCount: String(totalRelationships),
      });

      return {
        chunks: allChunks,
        entities: allEntities,
        relationships: totalRelationships,
      };
    } catch (error) {
      chunker.dispose();
      throw new PipelineError(
        `Failed to process interview ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        { sessionId, retireeId },
      );
    }
  }

  async reindexChunk(chunkId: string, retireeId: string): Promise<void> {
    logger.info('Reindexing chunk', {
      component: 'IndexingService',
      operation: 'reindexChunk',
      chunkId,
    });

    try {
      // Read existing chunk from Cosmos DB
      const existing = await this.cosmosClient.read<Record<string, unknown>>(
        'knowledgeChunks',
        chunkId,
        retireeId,
      );

      // Reconstruct the KnowledgeChunk
      const chunk: KnowledgeChunk = {
        id: String(existing['id']),
        content: String(existing['content']),
        summary: String(existing['summary']),
        knowledgeType: existing['knowledgeType'] as KnowledgeChunk['knowledgeType'],
        domainId: String(existing['domainId']),
        retireeId: String(existing['retireeId']),
        source: existing['source'] as KnowledgeChunk['source'],
        entities: existing['entities'] as EntityMention[],
        qualityScore: existing['qualityScore'] as KnowledgeChunk['qualityScore'],
        sensitivityLevel: existing['sensitivityLevel'] as KnowledgeChunk['sensitivityLevel'],
        consentId: String(existing['consentId']),
        createdAt: new Date(String(existing['createdAt'])),
        updatedAt: new Date(),
      };

      // Re-generate embedding and re-index
      await this.indexChunk(chunk);

      logger.info('Chunk reindexed successfully', {
        component: 'IndexingService',
        chunkId,
      });
    } catch (error) {
      throw new PipelineError(
        `Failed to reindex chunk ${chunkId}: ${error instanceof Error ? error.message : String(error)}`,
        { chunkId, retireeId },
      );
    }
  }
}
