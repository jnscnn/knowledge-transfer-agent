import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { logger } from '../../shared/logger.js';
import { AzureServiceError } from '../../shared/errors.js';
import { withRetry } from '../../shared/retry.js';
import type { QueryIntent } from '../../shared/types.js';

const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

const INTENT_PARSE_PROMPT = `You are an intent classification engine for a knowledge base of institutional knowledge from retiring employees.

Analyze the user's question and return a JSON object with these fields:
- type: one of "factual", "relational", "procedural", "decision_context", "exploratory", "meta"
- entities: array of entity names mentioned or implied (people, systems, processes, etc.)
- domains: array of knowledge domain names relevant to the question
- timeScope: optional object with "start" and "end" ISO date strings if the question implies a time range
- retireeScope: optional array of retiree names/identifiers if the question is about specific retirees

Return ONLY valid JSON, no markdown fences, no extra text.

User question: `;

interface RawIntentResponse {
  type?: string;
  entities?: string[];
  domains?: string[];
  timeScope?: { start?: string; end?: string };
  retireeScope?: string[];
}

const VALID_TYPES = new Set([
  'factual', 'relational', 'procedural', 'decision_context', 'exploratory', 'meta',
]);

export class IntentParser {
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

  async parseIntent(question: string): Promise<QueryIntent> {
    logger.debug('Parsing query intent', {
      component: 'IntentParser',
      question,
    });

    const raw = await withRetry(
      async () => {
        const response = await this.client.chat.completions.create({
          model: this.deploymentName,
          messages: [
            { role: 'system', content: INTENT_PARSE_PROMPT + question },
          ],
          max_tokens: 500,
          temperature: 0,
          response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new AzureServiceError(
            'AzureOpenAI', 'parseIntent', 'No content in response',
          );
        }
        return JSON.parse(content) as RawIntentResponse;
      },
      { maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 10_000, jitter: true },
    );

    const intentType = VALID_TYPES.has(raw.type ?? '')
      ? raw.type as QueryIntent['type']
      : 'exploratory';

    const intent: QueryIntent = {
      type: intentType,
      entities: Array.isArray(raw.entities) ? raw.entities : [],
      domains: Array.isArray(raw.domains) ? raw.domains : [],
    };

    if (raw.timeScope?.start && raw.timeScope?.end) {
      intent.timeScope = {
        start: new Date(raw.timeScope.start),
        end: new Date(raw.timeScope.end),
      };
    }

    if (Array.isArray(raw.retireeScope) && raw.retireeScope.length > 0) {
      intent.retireeScope = raw.retireeScope;
    }

    logger.info('Parsed query intent', {
      component: 'IntentParser',
      intentType: intent.type,
      entityCount: String(intent.entities.length),
    });

    return intent;
  }
}
