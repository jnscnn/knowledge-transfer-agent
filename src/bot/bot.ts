import { Application, TurnState } from '@microsoft/teams-ai';
import type { TurnContext } from 'botbuilder';
import { CardFactory, MemoryStorage } from 'botbuilder';
import type { InterviewAgent } from '../agents/interview/interview-agent.js';
import type { QueryAgent } from '../agents/query/query-agent.js';
import type { CosmosNoSqlClient } from '../storage/cosmos-nosql-client.js';
import { logger } from '../shared/logger.js';
import { InterviewHandler } from './handlers/interview-handler.js';
import { QueryHandler } from './handlers/query-handler.js';
import { FeedbackHandler } from './handlers/feedback-handler.js';
import { buildProgressCard } from './cards/progress-card.js';
import { buildConsentCard } from './cards/consent-card.js';
import type { RetireeProfile } from '../shared/types.js';

export function createBot(options: {
  interviewAgent: InterviewAgent;
  queryAgent: QueryAgent;
  cosmosClient: CosmosNoSqlClient;
}): Application<TurnState> {
  const interviewHandler = new InterviewHandler(
    options.interviewAgent,
    options.cosmosClient,
  );
  const queryHandler = new QueryHandler(options.queryAgent);
  const feedbackHandler = new FeedbackHandler(options.queryAgent);

  const app = new Application<TurnState>({
    storage: new MemoryStorage(),
    adaptiveCards: { actionSubmitFilter: 'type' },
    removeRecipientMention: true,
    startTypingTimer: true,
    longRunningMessages: false,
    turnStateFactory: () => new TurnState() as TurnState,
  });

  // ── Error handler ──

  app.error(async (_context, error) => {
    logger.error('Bot encountered an error', {
      component: 'Bot',
      error,
    });
  });

  // ── Command routes ──

  app.message(/^\/interview\s+start$/i, async (context, _state) => {
    const userId = context.activity.from.id;
    // For MVP, the retireeId is the user's own ID
    await interviewHandler.handleStartInterview(context, userId);
  });

  app.message(/^\/interview\s+end$/i, async (context, _state) => {
    const userId = context.activity.from.id;
    const session = await interviewHandler.isInInterview(userId);
    if (session.active && session.sessionId && session.retireeId) {
      await interviewHandler.handleEndInterview(
        context,
        session.sessionId,
        session.retireeId,
      );
    } else {
      await context.sendActivity(
        'You are not in an active interview session. Use `/interview start` to begin one.',
      );
    }
  });

  app.message(/^\/progress$/i, async (context, _state) => {
    const userId = context.activity.from.id;
    try {
      const retiree = await options.cosmosClient.read<RetireeProfile>(
        'retirees',
        userId,
        userId,
      );
      const domains = await options.cosmosClient.query<{ name: string; coverage: number }>(
        'knowledgeChunks',
        {
          query:
            'SELECT DISTINCT c.domainId as name, c.qualityScore.overall as coverage FROM c WHERE c.retireeId = @id',
          parameters: [{ name: '@id', value: userId }],
        },
      );

      const card = buildProgressCard({
        retiree: {
          name: retiree.name,
          overallCoverage: retiree.overallCoverage,
        },
        domains: domains.map((d) => ({
          name: d.name,
          coverage: d.coverage ?? 0,
          chunks: 0,
        })),
        recentSessions: 0,
        totalChunks: 0,
      });

      await context.sendActivity({
        attachments: [CardFactory.adaptiveCard(card)],
      });
    } catch {
      await context.sendActivity(
        '⚠️ Unable to load progress. You may not have a retiree profile set up yet.',
      );
    }
  });

  app.message(/^\/help$/i, async (context, _state) => {
    const helpText = [
      '**📚 Knowledge Transfer Agent — Commands**',
      '',
      '• **Ask a question** — Just type your question normally',
      '• `/interview start` — Begin a knowledge capture interview',
      '• `/interview end` — End the current interview session',
      '• `/progress` — View knowledge capture progress',
      '• `/help` — Show this help message',
    ].join('\n');

    await context.sendActivity(helpText);
  });

  // ── Default message handler (knowledge query or interview message) ──
  // Registered last so command routes take priority
  app.activity('message', async (context, _state) => {
    const text = context.activity.text?.trim();
    if (!text) return;

    const userId = context.activity.from.id;

    // Check if user is in an active interview
    const session = await interviewHandler.isInInterview(userId);
    if (session.active && session.sessionId && session.retireeId) {
      await interviewHandler.handleInterviewMessage(
        context,
        session.sessionId,
        session.retireeId,
        text,
      );
      return;
    }

    // Otherwise treat as a knowledge query
    await queryHandler.handleQuery(context, text, userId);
  });

  // ── Adaptive Card action handlers ──

  app.adaptiveCards.actionSubmit('feedback', async (context, _state, data) => {
    const cardData = data as Record<string, unknown>;
    const userId = context.activity.from.id;

    await feedbackHandler.handleFeedback(context, {
      queryId: cardData['queryId'] as string,
      value: cardData['value'] as 'positive' | 'negative',
      userId,
    });
  });

  app.adaptiveCards.actionSubmit(
    'follow_up_query',
    async (context, _state, data) => {
      const cardData = data as Record<string, unknown>;
      const userId = context.activity.from.id;
      await queryHandler.handleFollowUp(
        context,
        cardData['query'] as string,
        userId,
      );
    },
  );

  app.adaptiveCards.actionSubmit(
    'consent_response',
    async (context, _state, data) => {
      const cardData = data as Record<string, unknown>;
      const action = cardData['action'] as string;
      const userId = context.activity.from.id;

      if (action === 'accept') {
        await options.cosmosClient.upsert(
          'consent',
          {
            id: userId,
            retireeId: userId,
            grantedAt: new Date().toISOString(),
            grantedBy: userId,
            scope: {
              emailObservation: cardData['emailObservation'] === 'true',
              calendarObservation: cardData['calendarObservation'] === 'true',
              documentObservation: cardData['documentObservation'] === 'true',
              interviewCapture: cardData['interviewCapture'] === 'true',
              knowledgeSharing: cardData['knowledgeSharing'] === 'true',
              sensitivityLevelAllowed: 'internal',
            },
            revoked: false,
          },
          userId,
        );
        await context.sendActivity(
          '✅ Consent recorded. Thank you! You can now begin knowledge transfer sessions.',
        );
      } else {
        await context.sendActivity(
          '❌ Consent declined. No data will be collected. You can re-initiate consent at any time.',
        );
      }
    },
  );

  app.adaptiveCards.actionSubmit(
    'start_interview',
    async (context, _state, _data) => {
      const userId = context.activity.from.id;
      await interviewHandler.handleStartInterview(context, userId);
    },
  );

  app.adaptiveCards.actionSubmit(
    'end_interview',
    async (context, _state, _data) => {
      const userId = context.activity.from.id;
      const session = await interviewHandler.isInInterview(userId);
      if (session.active && session.sessionId && session.retireeId) {
        await interviewHandler.handleEndInterview(
          context,
          session.sessionId,
          session.retireeId,
        );
      }
    },
  );

  // ── Conversation update: welcome message on bot install ──

  app.conversationUpdate('membersAdded', async (context, _state) => {
    const membersAdded = context.activity.membersAdded ?? [];
    const botId = context.activity.recipient.id;

    for (const member of membersAdded) {
      if (member.id !== botId) {
        const welcomeText = [
          '👋 **Welcome to the Knowledge Transfer Agent!**',
          '',
          "I help capture and share institutional knowledge from colleagues who are transitioning out of their roles.",
          '',
          '**What I can do:**',
          '• 🔍 Answer questions about captured knowledge',
          '• 🎙️ Conduct structured knowledge capture interviews',
          '• 📈 Track knowledge coverage progress',
          '',
          'Type `/help` to see all available commands, or just ask me a question!',
        ].join('\n');

        await context.sendActivity(welcomeText);
      }
    }
  });

  return app;
}
