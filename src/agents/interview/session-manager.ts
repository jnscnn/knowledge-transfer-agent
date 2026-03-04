// ──────────────────────────────────────────────
// Interview session lifecycle management
// ──────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import type { InterviewSession } from '../../shared/types.js';
import type { CosmosNoSqlClient } from '../../storage/cosmos-nosql-client.js';
import { EntityNotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

export class SessionManager {
  private readonly cosmosClient: CosmosNoSqlClient;

  constructor(cosmosClient: CosmosNoSqlClient) {
    this.cosmosClient = cosmosClient;
  }

  /**
   * Create a new interview session with an auto-incremented session number.
   */
  async createSession(
    retireeId: string,
    focusDomains: string[],
  ): Promise<InterviewSession> {
    const nextNumber = await this.getNextSessionNumber(retireeId);

    const session: InterviewSession & Record<string, unknown> = {
      id: uuidv4(),
      retireeId,
      sessionNumber: nextNumber,
      startedAt: new Date(),
      status: 'in_progress',
      focusDomains,
      questionsAsked: [],
      knowledgeChunksProduced: [],
      coverageBefore: await this.getCurrentCoverage(retireeId),
    };

    logger.info('Creating interview session', {
      component: 'SessionManager',
      operation: 'createSession',
      correlationId: session.id,
      retireeId,
      sessionNumber: String(nextNumber),
    });

    await this.cosmosClient.create('interviewSessions', session, retireeId);
    return session;
  }

  /**
   * Retrieve a session by ID, scoped to a retiree.
   */
  async getSession(
    sessionId: string,
    retireeId: string,
  ): Promise<InterviewSession> {
    return this.cosmosClient.read<InterviewSession>(
      'interviewSessions',
      sessionId,
      retireeId,
    );
  }

  /**
   * Get the N most recent sessions for a retiree, ordered newest-first.
   */
  async getRecentSessions(
    retireeId: string,
    limit: number = 5,
  ): Promise<InterviewSession[]> {
    return this.cosmosClient.query<InterviewSession>(
      'interviewSessions',
      {
        query:
          'SELECT TOP @limit * FROM c WHERE c.retireeId = @retireeId ORDER BY c.startedAt DESC',
        parameters: [
          { name: '@retireeId', value: retireeId },
          { name: '@limit', value: limit },
        ],
      },
    );
  }

  /**
   * Persist an updated session document.
   */
  async updateSession(session: InterviewSession): Promise<void> {
    logger.debug('Updating session', {
      component: 'SessionManager',
      operation: 'updateSession',
      correlationId: session.id,
    });

    await this.cosmosClient.upsert(
      'interviewSessions',
      session as InterviewSession & Record<string, unknown>,
      session.retireeId,
    );
  }

  /**
   * Mark a session as completed and compute coverage delta.
   */
  async completeSession(
    sessionId: string,
    retireeId: string,
  ): Promise<InterviewSession> {
    const session = await this.getSession(sessionId, retireeId);

    if (session.status === 'completed') {
      logger.warn('Session already completed', {
        component: 'SessionManager',
        operation: 'completeSession',
        correlationId: sessionId,
      });
      return session;
    }

    session.status = 'completed';
    session.endedAt = new Date();
    session.coverageAfter = await this.computeCoverageAfter(session);

    await this.updateSession(session);

    logger.info('Session completed', {
      component: 'SessionManager',
      operation: 'completeSession',
      correlationId: sessionId,
      coverageDelta: String(
        (session.coverageAfter ?? 0) - session.coverageBefore,
      ),
      chunksProduced: String(session.knowledgeChunksProduced.length),
    });

    return session;
  }

  /**
   * Get session history for a retiree, optionally limited to the last N.
   */
  async getSessionHistory(
    retireeId: string,
    lastN?: number,
  ): Promise<InterviewSession[]> {
    const limit = lastN ?? 50;
    return this.cosmosClient.query<InterviewSession>(
      'interviewSessions',
      {
        query:
          'SELECT TOP @limit * FROM c WHERE c.retireeId = @retireeId ORDER BY c.sessionNumber DESC',
        parameters: [
          { name: '@retireeId', value: retireeId },
          { name: '@limit', value: limit },
        ],
      },
    );
  }

  // ── Private helpers ──

  private async getNextSessionNumber(retireeId: string): Promise<number> {
    const results = await this.cosmosClient.query<{ maxNum: number }>(
      'interviewSessions',
      {
        query:
          'SELECT VALUE MAX(c.sessionNumber) FROM c WHERE c.retireeId = @retireeId',
        parameters: [{ name: '@retireeId', value: retireeId }],
      },
    );
    const maxNum = results[0];
    return (typeof maxNum === 'number' ? maxNum : 0) + 1;
  }

  private async getCurrentCoverage(retireeId: string): Promise<number> {
    try {
      const retiree = await this.cosmosClient.read<{ overallCoverage: number }>(
        'retirees',
        retireeId,
        retireeId,
      );
      return retiree.overallCoverage ?? 0;
    } catch (error) {
      if (error instanceof EntityNotFoundError) return 0;
      throw error;
    }
  }

  private async computeCoverageAfter(session: InterviewSession): Promise<number> {
    // Coverage increase is estimated from the number of knowledge chunks produced
    // relative to the total expected chunks for the domains.
    const chunksProduced = session.knowledgeChunksProduced.length;
    const baseIncrement = Math.min(chunksProduced * 2, 20);
    return Math.min(100, session.coverageBefore + baseIncrement);
  }
}
