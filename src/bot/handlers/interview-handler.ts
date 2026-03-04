import type { TurnContext } from 'botbuilder';
import type { InterviewAgent } from '../../agents/interview/interview-agent.js';
import type { CosmosNoSqlClient } from '../../storage/cosmos-nosql-client.js';
import type { RetireeProfile } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';
import { BotError } from '../../shared/errors.js';
import {
  buildInterviewWelcomeCard,
  buildInterviewProgressCard,
  buildSessionSummaryCard,
} from '../cards/interview-card.js';
import { CardFactory } from 'botbuilder';

interface ActiveSession {
  sessionId: string;
  retireeId: string;
}

export class InterviewHandler {
  private readonly interviewAgent: InterviewAgent;
  private readonly cosmosClient: CosmosNoSqlClient;
  private readonly activeSessions = new Map<string, ActiveSession>();

  constructor(
    interviewAgent: InterviewAgent,
    cosmosClient: CosmosNoSqlClient,
  ) {
    this.interviewAgent = interviewAgent;
    this.cosmosClient = cosmosClient;
  }

  async handleStartInterview(
    context: TurnContext,
    retireeId: string,
  ): Promise<void> {
    const userId = context.activity.from.id;

    logger.info('Starting interview session', {
      component: 'InterviewHandler',
      operation: 'handleStartInterview',
      correlationId: userId,
      retireeId,
    });

    try {
      const { session, openingMessage } =
        await this.interviewAgent.startSession(retireeId);

      this.activeSessions.set(userId, {
        sessionId: session.id,
        retireeId,
      });

      const retiree = await this.getRetireeName(retireeId);

      const welcomeCard = buildInterviewWelcomeCard({
        name: retiree,
        sessionNumber: session.sessionNumber,
      });

      await context.sendActivity({
        attachments: [CardFactory.adaptiveCard(welcomeCard)],
      });
      await context.sendActivity(openingMessage);
    } catch (error) {
      logger.error('Failed to start interview', {
        component: 'InterviewHandler',
        error: error instanceof Error ? error : undefined,
        retireeId,
      });
      throw new BotError(
        `Failed to start interview: ${error instanceof Error ? error.message : String(error)}`,
        { retireeId },
      );
    }
  }

  async handleInterviewMessage(
    context: TurnContext,
    sessionId: string,
    retireeId: string,
    text: string,
  ): Promise<void> {
    logger.debug('Processing interview message', {
      component: 'InterviewHandler',
      operation: 'handleInterviewMessage',
      correlationId: sessionId,
    });

    try {
      const result = await this.interviewAgent.handleMessage(
        sessionId,
        retireeId,
        text,
      );

      await context.sendActivity(result.response);

      if (result.knowledgeChunks.length > 0) {
        await context.sendActivity(
          `💡 *${result.knowledgeChunks.length} knowledge chunk(s) captured from this response.*`,
        );
      }
    } catch (error) {
      logger.error('Failed to process interview message', {
        component: 'InterviewHandler',
        error: error instanceof Error ? error : undefined,
        correlationId: sessionId,
      });
      await context.sendActivity(
        '⚠️ Sorry, I encountered an error processing your response. Please try again.',
      );
    }
  }

  async handleEndInterview(
    context: TurnContext,
    sessionId: string,
    retireeId: string,
  ): Promise<void> {
    const userId = context.activity.from.id;

    logger.info('Ending interview session', {
      component: 'InterviewHandler',
      operation: 'handleEndInterview',
      correlationId: sessionId,
    });

    try {
      const result = await this.interviewAgent.endSession(
        sessionId,
        retireeId,
      );

      this.activeSessions.delete(userId);

      const summaryCard = buildSessionSummaryCard({
        chunksProduced: result.chunksProduced,
        coverageDelta: result.coverageDelta,
        nextSuggestion: result.nextSessionSuggestion,
      });

      await context.sendActivity({
        attachments: [CardFactory.adaptiveCard(summaryCard)],
      });
    } catch (error) {
      logger.error('Failed to end interview', {
        component: 'InterviewHandler',
        error: error instanceof Error ? error : undefined,
        correlationId: sessionId,
      });
      await context.sendActivity(
        '⚠️ Error ending the session. Please try `/interview end` again.',
      );
    }
  }

  async isInInterview(
    userId: string,
  ): Promise<{ active: boolean; sessionId?: string; retireeId?: string }> {
    const session = this.activeSessions.get(userId);
    if (session) {
      return {
        active: true,
        sessionId: session.sessionId,
        retireeId: session.retireeId,
      };
    }
    return { active: false };
  }

  private async getRetireeName(retireeId: string): Promise<string> {
    try {
      const profile = await this.cosmosClient.read<RetireeProfile>(
        'retirees',
        retireeId,
        retireeId,
      );
      return profile.name;
    } catch {
      return retireeId;
    }
  }
}
