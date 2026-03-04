// Azure OpenAI embedding generation

import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { logger } from '../shared/logger.js';
import { AzureServiceError } from '../shared/errors.js';
import { withRetry } from '../shared/retry.js';

const EMBEDDING_DIMENSIONS = 3072;
const MAX_BATCH_SIZE = 16;
const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

export class EmbeddingService {
  private client: AzureOpenAI;
  private deploymentName: string;

  constructor(endpoint: string, deploymentName: string) {
    this.deploymentName = deploymentName;

    const credential = new DefaultAzureCredential();
    const azureADTokenProvider = getBearerTokenProvider(credential, AZURE_OPENAI_SCOPE);

    this.client = new AzureOpenAI({
      endpoint,
      azureADTokenProvider,
      apiVersion: '2024-06-01',
    });
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[], batchSize: number = MAX_BATCH_SIZE): Promise<number[][]> {
    logger.debug('Generating embeddings', {
      component: 'EmbeddingService',
      textCount: String(texts.length),
      batchSize: String(batchSize),
    });

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      const embeddings = await withRetry(
        async () => {
          const response = await this.client.embeddings.create({
            model: this.deploymentName,
            input: batch,
            dimensions: EMBEDDING_DIMENSIONS,
          });
          return response.data.map((item) => item.embedding);
        },
        { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 30_000, jitter: true },
      );

      allEmbeddings.push(...embeddings);

      logger.debug('Batch embedding complete', {
        component: 'EmbeddingService',
        batchIndex: String(Math.floor(i / batchSize)),
        batchCount: String(batch.length),
      });
    }

    return allEmbeddings;
  }

  async embedWithHyde(question: string): Promise<number[]> {
    logger.debug('Generating HyDE embedding', {
      component: 'EmbeddingService',
      question,
    });

    // Generate a hypothetical answer paragraph using GPT-4o
    const hypotheticalAnswer = await withRetry(
      async () => {
        const response = await this.client.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content:
                'You are a helpful assistant. Given a question about institutional knowledge from a retiring employee, ' +
                'write a detailed paragraph that would be a good answer. Include specific names, systems, processes, ' +
                'and decisions that might be relevant. Write as if you are the retiring employee sharing their knowledge.',
            },
            {
              role: 'user',
              content: question,
            },
          ],
          max_tokens: 300,
          temperature: 0.7,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new AzureServiceError(
            'AzureOpenAI',
            'embedWithHyde',
            'No content in GPT-4o response',
          );
        }
        return content;
      },
      { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 30_000, jitter: true },
    );

    // Embed the hypothetical answer
    return this.embed(hypotheticalAnswer);
  }
}
