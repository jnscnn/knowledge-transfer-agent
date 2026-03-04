import type { TurnContext } from 'botbuilder';
import { v4 as uuidv4 } from 'uuid';
import type { QueryAgent } from '../../agents/query/query-agent.js';
import type { QueryFeedback } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

export class FeedbackHandler {
  private readonly queryAgent: QueryAgent;

  constructor(queryAgent: QueryAgent) {
    this.queryAgent = queryAgent;
  }

  async handleFeedback(
    context: TurnContext,
    data: { queryId: string; value: 'positive' | 'negative'; userId: string },
  ): Promise<void> {
    logger.info('Recording feedback', {
      component: 'FeedbackHandler',
      operation: 'handleFeedback',
      queryId: data.queryId,
      value: data.value,
    });

    try {
      const feedback: QueryFeedback = {
        id: uuidv4(),
        queryId: data.queryId,
        userId: data.userId,
        value: data.value,
        timestamp: new Date(),
        queryText: '',
        retrievedChunkIds: [],
        confidence: 0,
      };

      await this.queryAgent.recordFeedback(feedback);

      const emoji = data.value === 'positive' ? '👍' : '👎';
      await context.sendActivity(
        `${emoji} Thank you for your feedback! This helps improve our knowledge base.`,
      );
    } catch (error) {
      logger.error('Failed to record feedback', {
        component: 'FeedbackHandler',
        error: error instanceof Error ? error : undefined,
        queryId: data.queryId,
      });
      await context.sendActivity(
        '⚠️ Sorry, I was unable to record your feedback. Please try again.',
      );
    }
  }
}
