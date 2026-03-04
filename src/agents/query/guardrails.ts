import { logger } from '../../shared/logger.js';
import type { AgentResponse } from '../../shared/types.js';
import type { CosmosNoSqlClient } from '../../storage/cosmos-nosql-client.js';
import type { RankedResults, RankedItem } from './reranker.js';

const SENSITIVITY_HIERARCHY: readonly string[] = [
  'public',
  'internal',
  'confidential',
  'highly_confidential',
] as const;

function sensitivityRank(level: string): number {
  const idx = SENSITIVITY_HIERARCHY.indexOf(level);
  return idx === -1 ? 0 : idx;
}

export class QueryGuardrails {
  constructor(private cosmosClient: CosmosNoSqlClient) {}

  async filterByAccess(results: RankedResults, userId: string): Promise<RankedResults> {
    const userLevel = await this.getUserSensitivityLevel(userId);
    const userRank = sensitivityRank(userLevel);

    const filtered = results.items.filter((item) => {
      if (item.chunk) {
        const chunkRank = sensitivityRank(item.chunk.sensitivityLevel);
        return chunkRank <= userRank;
      }
      // Graph entities are allowed through — they contain no raw content
      return true;
    });

    const removedCount = results.items.length - filtered.length;
    if (removedCount > 0) {
      logger.info('Filtered results by access level', {
        component: 'QueryGuardrails',
        userId,
        userLevel,
        removedCount: String(removedCount),
        remainingCount: String(filtered.length),
      });
    }

    return {
      items: filtered,
      totalSources: results.totalSources,
      sourceDiversity: results.sourceDiversity,
    };
  }

  validateResponse(response: AgentResponse): { valid: boolean; reason?: string } {
    // Block answers with extremely low confidence
    if (response.confidence < 0.1) {
      return {
        valid: false,
        reason: 'Insufficient data to provide a reliable answer.',
      };
    }

    // Require at least one source for any factual claim
    if (response.sources.length === 0 && response.coverage !== 'insufficient') {
      return {
        valid: false,
        reason: 'No sources available to support the answer.',
      };
    }

    return { valid: true };
  }

  redactSensitive(answer: string, userSensitivityLevel: string): string {
    const userRank = sensitivityRank(userSensitivityLevel);

    // If user has full access, no redaction needed
    if (userRank >= SENSITIVITY_HIERARCHY.length - 1) {
      return answer;
    }

    // Redact common patterns of sensitive data that may have leaked through
    let redacted = answer;

    if (userRank < sensitivityRank('confidential')) {
      // Redact email addresses
      redacted = redacted.replace(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        '[REDACTED EMAIL]',
      );
      // Redact phone numbers
      redacted = redacted.replace(
        /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
        '[REDACTED PHONE]',
      );
    }

    if (userRank < sensitivityRank('internal')) {
      // Redact IP addresses
      redacted = redacted.replace(
        /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
        '[REDACTED IP]',
      );
    }

    return redacted;
  }

  private async getUserSensitivityLevel(userId: string): Promise<string> {
    try {
      const results = await this.cosmosClient.query<{ sensitivityLevelAllowed: string }>(
        'consent',
        {
          query: 'SELECT c.scope.sensitivityLevelAllowed FROM c WHERE c.grantedBy = @userId AND c.revoked = false ORDER BY c.grantedAt DESC OFFSET 0 LIMIT 1',
          parameters: [{ name: '@userId', value: userId }],
        },
      );

      if (results.length > 0 && results[0].sensitivityLevelAllowed) {
        return results[0].sensitivityLevelAllowed;
      }
    } catch (error) {
      logger.warn('Failed to fetch user sensitivity level, defaulting to public', {
        component: 'QueryGuardrails',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Default to most restrictive level
    return 'public';
  }
}
