// ──────────────────────────────────────────────
// Topic coverage tracker per retiree
// ──────────────────────────────────────────────

import type { KnowledgeDomain, InterviewSession } from '../../shared/types.js';
import type { CosmosNoSqlClient } from '../../storage/cosmos-nosql-client.js';
import { logger } from '../../shared/logger.js';
import { questionTemplates } from './prompts/question-templates.js';

export class TopicTracker {
  private readonly retireeId: string;
  private readonly cosmosClient: CosmosNoSqlClient;

  constructor(retireeId: string, cosmosClient: CosmosNoSqlClient) {
    this.retireeId = retireeId;
    this.cosmosClient = cosmosClient;
  }

  /**
   * Returns a map of domain name → coverage percentage (0–100)
   * calculated from completed interview sessions.
   */
  async getCoveredTopics(): Promise<Map<string, number>> {
    const sessions = await this.cosmosClient.query<InterviewSession>(
      'interviewSessions',
      {
        query: 'SELECT * FROM c WHERE c.retireeId = @retireeId AND c.status = "completed"',
        parameters: [{ name: '@retireeId', value: this.retireeId }],
      },
    );

    const domainCoverage = new Map<string, number>();

    for (const session of sessions) {
      for (const domain of session.focusDomains) {
        const current = domainCoverage.get(domain) ?? 0;
        // Each completed session that focused on a domain contributes to its coverage.
        // Use coverageAfter if available, otherwise increment by a base amount.
        const sessionContribution = session.coverageAfter !== undefined
          ? session.coverageAfter - session.coverageBefore
          : 10;
        domainCoverage.set(domain, Math.min(100, current + sessionContribution));
      }
    }

    return domainCoverage;
  }

  /**
   * Returns knowledge domains that have not yet been adequately covered.
   */
  async getUncoveredDomains(): Promise<KnowledgeDomain[]> {
    const allDomains = await this.cosmosClient.query<KnowledgeDomain>(
      'observations',
      {
        query: 'SELECT * FROM c WHERE c.retireeId = @retireeId AND IS_DEFINED(c.coverage)',
        parameters: [{ name: '@retireeId', value: this.retireeId }],
      },
    );

    const coveredTopics = await this.getCoveredTopics();
    const threshold = 50;

    return allDomains.filter((domain) => {
      const coverage = coveredTopics.get(domain.name) ?? 0;
      return coverage < threshold;
    });
  }

  /**
   * Produces a prioritised gap analysis: which domains need more coverage and why.
   */
  async getGapAnalysis(): Promise<Array<{ domain: string; gap: string; priority: number }>> {
    const uncovered = await this.getUncoveredDomains();
    const coveredTopics = await this.getCoveredTopics();

    const criticalityWeight: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    return uncovered
      .map((domain) => {
        const currentCoverage = coveredTopics.get(domain.name) ?? 0;
        const weight = criticalityWeight[domain.criticality] ?? 1;
        const priority = weight * (100 - currentCoverage);

        return {
          domain: domain.name,
          gap: `${currentCoverage}% covered — criticality: ${domain.criticality}`,
          priority,
        };
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Record updated coverage for a domain after a session.
   */
  async recordCoverage(domain: string, coverage: number): Promise<void> {
    logger.info('Recording coverage update', {
      component: 'TopicTracker',
      operation: 'recordCoverage',
      retireeId: this.retireeId,
      domain,
      coverage: String(coverage),
    });

    const existing = await this.cosmosClient.query<KnowledgeDomain>(
      'observations',
      {
        query: 'SELECT * FROM c WHERE c.retireeId = @retireeId AND c.name = @name',
        parameters: [
          { name: '@retireeId', value: this.retireeId },
          { name: '@name', value: domain },
        ],
      },
    );

    if (existing.length > 0) {
      const doc = existing[0] as KnowledgeDomain & Record<string, unknown>;
      doc.coverage = {
        ...doc.coverage,
        captured: Math.min(100, coverage),
      };
      await this.cosmosClient.upsert('observations', doc, this.retireeId);
    }
  }

  /**
   * Suggest the next domain to focus on, with reasoning and starter questions.
   */
  async suggestNextFocus(): Promise<{
    domain: string;
    reason: string;
    suggestedQuestions: string[];
  }> {
    const gaps = await this.getGapAnalysis();

    if (gaps.length === 0) {
      return {
        domain: 'general',
        reason: 'All identified domains have adequate coverage. Consider exploring miscellaneous or cross-cutting knowledge.',
        suggestedQuestions: [
          'Are there any areas we haven\'t discussed that you think your successor should know about?',
          'What are the most important cross-team relationships that keep things running?',
        ],
      };
    }

    const topGap = gaps[0];
    const templates = questionTemplates[topGap.domain] ?? [];
    const suggestedQuestions = templates.length > 0
      ? templates.slice(0, 3)
      : [
          `Tell me about your involvement in ${topGap.domain}.`,
          `What does a typical week look like for you in relation to ${topGap.domain}?`,
        ];

    return {
      domain: topGap.domain,
      reason: `${topGap.domain} has the highest priority gap: ${topGap.gap}`,
      suggestedQuestions,
    };
  }
}
