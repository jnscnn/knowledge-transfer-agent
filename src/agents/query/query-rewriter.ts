import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { logger } from '../../shared/logger.js';
import { AzureServiceError } from '../../shared/errors.js';
import { withRetry } from '../../shared/retry.js';
import type { QueryIntent, RewrittenQuery, SearchFilters } from '../../shared/types.js';
import { getQueryRewritePrompt } from './prompts/query-rewrite.js';

const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

interface RawRewriteResponse {
  vectorQuery?: string;
  keywordQuery?: string;
  graphConcept?: {
    entities?: string[];
    relationshipTypes?: string[];
    queryPattern?: string;
  };
  intent?: string;
}

export class QueryRewriter {
  private client: AzureOpenAI;
  private deploymentName: string;

  constructor(openaiEndpoint: string, deploymentName: string) {
    this.deploymentName = deploymentName;

    const credential = new DefaultAzureCredential();
    const azureADTokenProvider = getBearerTokenProvider(credential, AZURE_OPENAI_SCOPE);

    this.client = new AzureOpenAI({
      endpoint: openaiEndpoint,
      azureADTokenProvider,
      apiVersion: '2024-06-01',
    });
  }

  async rewrite(question: string, intent: QueryIntent): Promise<RewrittenQuery> {
    logger.debug('Rewriting query', {
      component: 'QueryRewriter',
      question,
      intentType: intent.type,
    });

    const raw = await withRetry(
      async () => {
        const response = await this.client.chat.completions.create({
          model: this.deploymentName,
          messages: [
            { role: 'user', content: getQueryRewritePrompt(question) },
          ],
          max_tokens: 600,
          temperature: 0,
          response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new AzureServiceError(
            'AzureOpenAI', 'rewrite', 'No content in response',
          );
        }
        return JSON.parse(content) as RawRewriteResponse;
      },
      { maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 10_000, jitter: true },
    );

    const filters = this.buildFilters(intent);

    // Build graph query from graph concept if present
    let graphQuery: string | undefined;
    if (raw.graphConcept?.queryPattern) {
      graphQuery = raw.graphConcept.queryPattern;
    }

    const rewritten: RewrittenQuery = {
      vectorQuery: raw.vectorQuery ?? question,
      keywordQuery: raw.keywordQuery ?? question,
      graphQuery,
      filters,
    };

    logger.info('Query rewritten', {
      component: 'QueryRewriter',
      hasGraphQuery: String(!!graphQuery),
      filterDomains: String(filters.domains?.length ?? 0),
    });

    return rewritten;
  }

  private buildFilters(intent: QueryIntent): SearchFilters {
    const filters: SearchFilters = {};

    if (intent.domains.length > 0) {
      filters.domains = intent.domains;
    }

    if (intent.retireeScope && intent.retireeScope.length > 0) {
      filters.retireeIds = intent.retireeScope;
    }

    return filters;
  }
}
