import type { TurnContext } from 'botbuilder';
import { CardFactory } from 'botbuilder';
import type { QueryAgent } from '../../agents/query/query-agent.js';
import { logger } from '../../shared/logger.js';
import { buildAnswerCard } from '../cards/answer-card.js';

export class QueryHandler {
  private readonly queryAgent: QueryAgent;

  constructor(queryAgent: QueryAgent) {
    this.queryAgent = queryAgent;
  }

  async handleQuery(
    context: TurnContext,
    question: string,
    userId: string,
  ): Promise<void> {
    logger.info('Handling knowledge query', {
      component: 'QueryHandler',
      operation: 'handleQuery',
      correlationId: userId,
      questionLength: String(question.length),
    });

    try {
      await context.sendActivity('🔍 Searching knowledge base...');

      const response = await this.queryAgent.query(question, userId);
      const card = buildAnswerCard(response);

      await context.sendActivity({
        attachments: [CardFactory.adaptiveCard(card)],
      });
    } catch (error) {
      logger.error('Query failed', {
        component: 'QueryHandler',
        error: error instanceof Error ? error : undefined,
        correlationId: userId,
      });
      await context.sendActivity(
        '⚠️ Sorry, I was unable to process your question. Please try again or rephrase your query.',
      );
    }
  }

  async handleFollowUp(
    context: TurnContext,
    query: string,
    userId: string,
  ): Promise<void> {
    logger.info('Handling follow-up query', {
      component: 'QueryHandler',
      operation: 'handleFollowUp',
      correlationId: userId,
    });

    await this.handleQuery(context, query, userId);
  }
}
