import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../shared/logger.js';
import { AzureServiceError } from '../../shared/errors.js';
import { withRetry } from '../../shared/retry.js';
import type { AgentResponse, Citation, KnowledgeChunk } from '../../shared/types.js';
import type { RankedResults, RankedItem } from './reranker.js';

const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

const TOP_K = 10;

// ── Confidence weighting factors ──

interface ConfidenceFactors {
  sourceCount: number;
  topRelevance: number;
  sourceDiversity: number;
  corroboration: number;
  recency: number;
  completeness: number;
}

const CONFIDENCE_WEIGHTS: Record<keyof ConfidenceFactors, number> = {
  sourceCount: 0.15,
  topRelevance: 0.25,
  sourceDiversity: 0.15,
  corroboration: 0.20,
  recency: 0.10,
  completeness: 0.15,
};

function loadSystemPrompt(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const promptPath = join(currentDir, 'prompts', 'system-prompt.md');
  return readFileSync(promptPath, 'utf-8');
}

function buildContext(items: RankedItem[]): string {
  const contextParts: string[] = [];
  let sourceIndex = 1;

  for (const item of items) {
    if (item.chunk) {
      const c = item.chunk;
      contextParts.push(
        `=== Source ${sourceIndex} (type: ${c.source.type}) ===\n` +
        `Retiree: ${c.retireeId}\n` +
        `Date: ${c.source.timestamp.toISOString()}\n` +
        `Domain: ${c.domainId}\n` +
        `Quality: ${c.qualityScore.overall.toFixed(2)}\n` +
        `---\n${c.content}`,
      );
      sourceIndex++;
    } else if (item.entity) {
      const e = item.entity;
      contextParts.push(
        `=== Source ${sourceIndex} (type: graph_entity) ===\n` +
        `Entity: ${e.name} (${e.type})\n` +
        `Description: ${e.description}\n` +
        `Domains: ${e.domains.join(', ')}\n` +
        `Mentions: ${e.mentionCount}\n` +
        `---\n${e.description}`,
      );
      sourceIndex++;
    }
  }

  return contextParts.join('\n\n');
}

function buildCitations(items: RankedItem[]): Citation[] {
  const citations: Citation[] = [];

  for (const item of items) {
    if (item.chunk) {
      const c = item.chunk;
      citations.push({
        type: c.source.type,
        sourceId: c.id,
        title: c.summary || `${c.source.type} — ${c.domainId}`,
        relevance: item.combinedScore,
        timestamp: c.source.timestamp,
        retiree: c.retireeId,
      });
    }
  }

  return citations;
}

function computeConfidence(items: RankedItem[], sourceDiversity: number): number {
  if (items.length === 0) return 0;

  const factors: ConfidenceFactors = {
    sourceCount: Math.min(1, items.length / 5),
    topRelevance: Math.min(1, (items[0]?.combinedScore ?? 0) * 30),
    sourceDiversity: Math.min(1, sourceDiversity),
    corroboration: computeCorroboration(items),
    recency: computeRecency(items),
    completeness: Math.min(1, items.length / 3),
  };

  let confidence = 0;
  for (const [key, weight] of Object.entries(CONFIDENCE_WEIGHTS)) {
    confidence += factors[key as keyof ConfidenceFactors] * weight;
  }

  return Math.min(1, Math.max(0, confidence));
}

function computeCorroboration(items: RankedItem[]): number {
  const multiSourceItems = items.filter((i) => i.sources.length > 1);
  return items.length > 0 ? multiSourceItems.length / items.length : 0;
}

function computeRecency(items: RankedItem[]): number {
  const now = Date.now();
  const oneYear = 365 * 24 * 60 * 60 * 1_000;
  let totalRecency = 0;
  let counted = 0;

  for (const item of items) {
    if (item.chunk) {
      const age = now - item.chunk.source.timestamp.getTime();
      totalRecency += Math.max(0, 1 - age / oneYear);
      counted++;
    }
  }

  return counted > 0 ? totalRecency / counted : 0.5;
}

function determineCoverage(items: RankedItem[], confidence: number): AgentResponse['coverage'] {
  if (items.length === 0 || confidence < 0.2) return 'insufficient';
  if (confidence >= 0.6 && items.length >= 3) return 'complete';
  return 'partial';
}

function generateFollowUps(items: RankedItem[]): string[] {
  const followUps: string[] = [];
  const domains = new Set<string>();
  const entities = new Set<string>();

  for (const item of items) {
    if (item.chunk) {
      domains.add(item.chunk.domainId);
      for (const e of item.chunk.entities) {
        entities.add(e.text);
      }
    }
    if (item.entity) {
      entities.add(item.entity.name);
    }
  }

  if (domains.size > 1) {
    const domainArr = [...domains];
    followUps.push(
      `How do ${domainArr[0]} and ${domainArr[1]} interact?`,
    );
  }

  for (const entity of [...entities].slice(0, 2)) {
    followUps.push(`What else do we know about ${entity}?`);
  }

  if (followUps.length === 0) {
    followUps.push('What other knowledge domains should I explore?');
  }

  return followUps.slice(0, 3);
}

// ── Answer Generator ──

export class AnswerGenerator {
  private client: AzureOpenAI;
  private deploymentName: string;
  private systemPrompt: string;

  constructor(openaiEndpoint: string, deploymentName: string) {
    this.deploymentName = deploymentName;
    this.systemPrompt = loadSystemPrompt();

    const credential = new DefaultAzureCredential();
    const azureADTokenProvider = getBearerTokenProvider(credential, AZURE_OPENAI_SCOPE);

    this.client = new AzureOpenAI({
      endpoint: openaiEndpoint,
      azureADTokenProvider,
      apiVersion: '2024-06-01',
    });
  }

  async generate(question: string, rankedResults: RankedResults): Promise<AgentResponse> {
    const startMs = Date.now();
    const queryId = uuidv4();

    logger.info('Generating answer', {
      component: 'AnswerGenerator',
      queryId,
      resultCount: String(rankedResults.items.length),
    });

    const topItems = rankedResults.items.slice(0, TOP_K);
    const context = buildContext(topItems);
    const citations = buildCitations(topItems);
    const confidence = computeConfidence(topItems, rankedResults.sourceDiversity);
    const coverage = determineCoverage(topItems, confidence);

    // If no context available, return insufficient response
    if (topItems.length === 0) {
      return {
        queryId,
        answer: 'I could not find any relevant information in the knowledge base to answer this question. Please try rephrasing or ask about a different topic.',
        confidence: 0,
        sources: [],
        coverage: 'insufficient',
        followUps: ['What knowledge domains are available?', 'Who are the retirees in the system?'],
        processingTimeMs: Date.now() - startMs,
      };
    }

    const answer = await withRetry(
      async () => {
        const response = await this.client.chat.completions.create({
          model: this.deploymentName,
          messages: [
            { role: 'system', content: this.systemPrompt },
            {
              role: 'user',
              content: `Context:\n${context}\n\n---\n\nQuestion: ${question}`,
            },
          ],
          max_tokens: 1500,
          temperature: 0.3,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new AzureServiceError(
            'AzureOpenAI', 'generate', 'No content in response',
          );
        }
        return content;
      },
      { maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 15_000, jitter: true },
    );

    const followUps = generateFollowUps(topItems);

    const agentResponse: AgentResponse = {
      queryId,
      answer,
      confidence,
      sources: citations,
      coverage,
      followUps,
      processingTimeMs: Date.now() - startMs,
    };

    logger.info('Answer generated', {
      component: 'AnswerGenerator',
      queryId,
      confidence: String(confidence.toFixed(2)),
      coverage,
      citationCount: String(citations.length),
      durationMs: String(agentResponse.processingTimeMs),
    });

    return agentResponse;
  }
}
