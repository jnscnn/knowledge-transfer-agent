// Identify knowledge gaps by comparing observed domains vs captured knowledge

import { logger } from '../shared/logger.js';
import type { DomainClassification, KnowledgeDomain } from '../shared/types.js';
import type { CosmosNoSqlClient } from '../storage/cosmos-nosql-client.js';

export interface KnowledgeGap {
  domain: string;
  observedEvidence: number;
  capturedCoverage: number;
  gapScore: number;
  suggestedActions: string[];
}

export class GapIdentifier {
  private cosmosClient: CosmosNoSqlClient;

  constructor(cosmosClient: CosmosNoSqlClient) {
    this.cosmosClient = cosmosClient;
  }

  async identifyGaps(
    retireeId: string,
    observedDomains: DomainClassification[],
  ): Promise<KnowledgeGap[]> {
    logger.info('Identifying knowledge gaps', {
      component: 'GapIdentifier',
      operation: 'identifyGaps',
      retireeId,
      observedDomainCount: String(observedDomains.length),
    });

    // Fetch captured knowledge domains from Cosmos
    const capturedDomains = await this.cosmosClient.query<KnowledgeDomain>(
      'knowledgeChunks',
      {
        query: 'SELECT DISTINCT VALUE c.domainId FROM c WHERE c.retireeId = @retireeId',
        parameters: [{ name: '@retireeId', value: retireeId }],
      },
    );

    // Fetch chunk counts per domain
    const domainChunkCounts = await this.cosmosClient.query<{ domainId: string; count: number }>(
      'knowledgeChunks',
      {
        query:
          'SELECT c.domainId, COUNT(1) AS count FROM c WHERE c.retireeId = @retireeId GROUP BY c.domainId',
        parameters: [{ name: '@retireeId', value: retireeId }],
      },
    );

    const capturedMap = new Map<string, number>();
    for (const item of domainChunkCounts) {
      capturedMap.set(item.domainId, item.count);
    }

    const capturedDomainSet = new Set(capturedDomains.map((d) => (typeof d === 'string' ? d : d.id)));

    const gaps: KnowledgeGap[] = [];

    for (const observed of observedDomains) {
      const totalEvidence =
        observed.evidence.emails +
        observed.evidence.meetings +
        observed.evidence.documents +
        observed.evidence.teamsMessages;

      const capturedChunks = capturedMap.get(observed.domain) ?? 0;

      // Normalize captured coverage: assume ~10 chunks = full coverage for a domain
      const capturedCoverage = Math.min(capturedChunks / 10, 1);

      // Gap score: high evidence + low coverage = high gap
      const gapScore = observed.confidence * (1 - capturedCoverage);

      const suggestedActions = this.generateActions(
        observed,
        capturedCoverage,
        capturedDomainSet.has(observed.domain),
      );

      gaps.push({
        domain: observed.domain,
        observedEvidence: totalEvidence,
        capturedCoverage: Math.round(capturedCoverage * 100) / 100,
        gapScore: Math.round(gapScore * 100) / 100,
        suggestedActions,
      });
    }

    // Sort by gap score descending (highest priority first)
    gaps.sort((a, b) => b.gapScore - a.gapScore);

    logger.info('Knowledge gaps identified', {
      component: 'GapIdentifier',
      retireeId,
      totalGaps: String(gaps.length),
      highPriorityGaps: String(gaps.filter((g) => g.gapScore > 0.5).length),
    });

    return gaps;
  }

  private generateActions(
    observed: DomainClassification,
    capturedCoverage: number,
    hasAnyCaptured: boolean,
  ): string[] {
    const actions: string[] = [];

    if (!hasAnyCaptured) {
      actions.push(`Schedule initial interview focused on "${observed.domain}"`);
      actions.push('Create knowledge domain entry and assign criticality level');
    }

    if (capturedCoverage < 0.3) {
      actions.push(`Conduct deep-dive interview on "${observed.domain}"`);
      if (observed.suggestedInterviewQuestions.length > 0) {
        actions.push(`Use suggested questions: ${observed.suggestedInterviewQuestions[0]}`);
      }
    } else if (capturedCoverage < 0.7) {
      actions.push(`Schedule follow-up interview to fill gaps in "${observed.domain}"`);
    }

    if (observed.gapIndicators.length > 0) {
      actions.push(`Address gap indicators: ${observed.gapIndicators.join(', ')}`);
    }

    if (observed.evidence.documents > 5) {
      actions.push('Review and index related documents for this domain');
    }

    return actions;
  }
}
