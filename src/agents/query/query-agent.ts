import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../shared/logger.js';
import { PipelineError } from '../../shared/errors.js';
import type { AgentResponse, QueryFeedback } from '../../shared/types.js';
import type { SearchClientWrapper } from '../../storage/search-client.js';
import type { CosmosNoSqlClient } from '../../storage/cosmos-nosql-client.js';
import type { CosmosGremlinClient } from '../../storage/cosmos-gremlin-client.js';
import type { EmbeddingService } from '../../pipeline/embedding.js';
import { IntentParser } from './intent-parser.js';
import { QueryRewriter } from './query-rewriter.js';
import { MultiSourceRetriever } from './retriever.js';
import { ResultReranker } from './reranker.js';
import { AnswerGenerator } from './answer-generator.js';
import { QueryGuardrails } from './guardrails.js';

export interface QueryAgentOptions {
  searchService: SearchClientWrapper;
  cosmosClient: CosmosNoSqlClient;
  gremlinClient: CosmosGremlinClient;
  embeddingService: EmbeddingService;
  openaiEndpoint: string;
  deploymentName: string;
}

export class QueryAgent {
  private intentParser: IntentParser;
  private queryRewriter: QueryRewriter;
  private retriever: MultiSourceRetriever;
  private reranker: ResultReranker;
  private answerGenerator: AnswerGenerator;
  private guardrails: QueryGuardrails;
  private cosmosClient: CosmosNoSqlClient;

  constructor(options: QueryAgentOptions) {
    this.cosmosClient = options.cosmosClient;

    this.intentParser = new IntentParser(
      options.openaiEndpoint,
      options.deploymentName,
    );
    this.queryRewriter = new QueryRewriter(
      options.openaiEndpoint,
      options.deploymentName,
    );
    this.retriever = new MultiSourceRetriever(
      options.searchService,
      options.gremlinClient,
      options.embeddingService,
    );
    this.reranker = new ResultReranker();
    this.answerGenerator = new AnswerGenerator(
      options.openaiEndpoint,
      options.deploymentName,
    );
    this.guardrails = new QueryGuardrails(options.cosmosClient);
  }

  async query(question: string, userId: string): Promise<AgentResponse> {
    const pipelineStartMs = Date.now();
    const queryId = uuidv4();

    logger.info('Query pipeline started', {
      component: 'QueryAgent',
      queryId,
      userId,
      questionLength: String(question.length),
    });

    try {
      // 1. Parse intent
      const intent = await this.intentParser.parseIntent(question);
      logger.debug('Intent parsed', {
        component: 'QueryAgent',
        queryId,
        intentType: intent.type,
      });

      // 2. Rewrite query
      const rewrittenQuery = await this.queryRewriter.rewrite(question, intent);
      logger.debug('Query rewritten', {
        component: 'QueryAgent',
        queryId,
        hasGraphQuery: String(!!rewrittenQuery.graphQuery),
      });

      // 3–4. Retrieve from multiple sources (includes HyDE embedding internally)
      const retrievalResults = await this.retriever.retrieve(rewrittenQuery);

      // 5. Rerank results
      const rankedResults = this.reranker.rerank(retrievalResults, rewrittenQuery);
      logger.debug('Results reranked', {
        component: 'QueryAgent',
        queryId,
        rankedCount: String(rankedResults.items.length),
      });

      // 6. Apply access control guardrails
      const filteredResults = await this.guardrails.filterByAccess(rankedResults, userId);

      // 7. Generate answer with citations
      const response = await this.answerGenerator.generate(question, filteredResults);

      // Overwrite the queryId to match the pipeline-level ID
      const finalResponse: AgentResponse = {
        ...response,
        queryId,
        processingTimeMs: Date.now() - pipelineStartMs,
      };

      // 8. Validate response
      const validation = this.guardrails.validateResponse(finalResponse);
      if (!validation.valid) {
        logger.warn('Response failed validation', {
          component: 'QueryAgent',
          queryId,
          reason: validation.reason,
        });
        finalResponse.answer = validation.reason ?? 'Unable to provide a reliable answer.';
        finalResponse.coverage = 'insufficient';
        finalResponse.confidence = 0;
      }

      // 9. Store query in Cosmos DB for analytics
      await this.storeQueryRecord(queryId, question, userId, finalResponse, intent.type);

      logger.info('Query pipeline complete', {
        component: 'QueryAgent',
        queryId,
        confidence: String(finalResponse.confidence.toFixed(2)),
        coverage: finalResponse.coverage,
        sourceCount: String(finalResponse.sources.length),
        totalMs: String(finalResponse.processingTimeMs),
      });

      // 10. Return AgentResponse
      return finalResponse;
    } catch (error) {
      logger.error('Query pipeline failed', {
        component: 'QueryAgent',
        queryId,
        error: error instanceof Error ? error : undefined,
      });

      throw new PipelineError(
        `Query pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
        { queryId, question },
      );
    }
  }

  async recordFeedback(feedback: QueryFeedback): Promise<void> {
    logger.info('Recording query feedback', {
      component: 'QueryAgent',
      queryId: feedback.queryId,
      value: feedback.value,
    });

    await this.cosmosClient.upsert(
      'queries',
      {
        id: feedback.id,
        type: 'feedback',
        queryId: feedback.queryId,
        userId: feedback.userId,
        value: feedback.value,
        comment: feedback.comment,
        timestamp: feedback.timestamp.toISOString(),
        queryText: feedback.queryText,
        retrievedChunkIds: feedback.retrievedChunkIds,
        confidence: feedback.confidence,
      },
      feedback.id,
    );
  }

  private async storeQueryRecord(
    queryId: string,
    question: string,
    userId: string,
    response: AgentResponse,
    intentType: string,
  ): Promise<void> {
    try {
      await this.cosmosClient.upsert(
        'queries',
        {
          id: queryId,
          type: 'query',
          question,
          userId,
          intentType,
          confidence: response.confidence,
          coverage: response.coverage,
          sourceCount: response.sources.length,
          sourceIds: response.sources.map((s) => s.sourceId),
          processingTimeMs: response.processingTimeMs,
          timestamp: new Date().toISOString(),
        },
        queryId,
      );
    } catch (error) {
      // Non-critical — log and continue
      logger.warn('Failed to store query record', {
        component: 'QueryAgent',
        queryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
