// ──────────────────────────────────────────────
// Interview Agent — main orchestrator
// ──────────────────────────────────────────────

import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import type {
  FunctionToolDefinition,
  ThreadRun,
  RequiredFunctionToolCall,
  ToolOutput,
  ThreadMessage,
  SubmitToolOutputsAction,
  MessageTextContent,
} from '@azure/ai-agents';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  InterviewSession,
  KnowledgeChunk,
  EntityMention,
  RetireeProfile,
} from '../../shared/types.js';
import { logger } from '../../shared/logger.js';
import { withRetry } from '../../shared/retry.js';
import { AzureServiceError, EntityNotFoundError } from '../../shared/errors.js';
import type { CosmosNoSqlClient } from '../../storage/cosmos-nosql-client.js';
import { SessionManager } from './session-manager.js';
import { QuestionGenerator } from './question-generator.js';
import { TopicTracker } from './topic-tracker.js';
import { sessionOpeningTemplate } from './prompts/question-templates.js';

// ── Resolve __dirname for ESM ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Tool definitions exposed to the AI Foundry agent ──

const TOOL_DEFINITIONS: FunctionToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_observation_summary',
      description:
        'Retrieve prior observation findings (email patterns, meeting topics, document usage) for a retiree.',
      parameters: {
        type: 'object',
        properties: {
          retiree_id: { type: 'string', description: 'The retiree identifier' },
        },
        required: ['retiree_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_coverage_gaps',
      description:
        'Get a list of knowledge domains and their coverage percentages, highlighting gaps.',
      parameters: {
        type: 'object',
        properties: {
          retiree_id: { type: 'string', description: 'The retiree identifier' },
        },
        required: ['retiree_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_knowledge_chunk',
      description:
        'Save a discrete piece of captured knowledge from the interview.',
      parameters: {
        type: 'object',
        properties: {
          retiree_id: { type: 'string', description: 'The retiree identifier' },
          content: { type: 'string', description: 'The knowledge content' },
          summary: { type: 'string', description: 'Brief summary' },
          knowledge_type: {
            type: 'string',
            enum: ['tacit', 'explicit', 'relational'],
          },
          domain: { type: 'string', description: 'Knowledge domain' },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                type: { type: 'string' },
                confidence: { type: 'number' },
              },
            },
            description: 'Entities mentioned in this knowledge',
          },
          sensitivity: {
            type: 'string',
            enum: ['public', 'internal', 'confidential', 'highly_confidential'],
          },
        },
        required: ['retiree_id', 'content', 'summary', 'knowledge_type', 'domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_session_history',
      description:
        'Retrieve summaries of prior interview sessions for a retiree.',
      parameters: {
        type: 'object',
        properties: {
          retiree_id: { type: 'string', description: 'The retiree identifier' },
          last_n: {
            type: 'number',
            description: 'Number of recent sessions to retrieve',
          },
        },
        required: ['retiree_id'],
      },
    },
  },
];

// ── Types for internal state ──

interface AgentState {
  agentId: string;
  threadId: string;
}

export class InterviewAgent {
  private readonly projectClient: AIProjectClient;
  private readonly cosmosClient: CosmosNoSqlClient;
  private readonly sessionManager: SessionManager;
  private readonly questionGenerator: QuestionGenerator;
  private readonly systemPrompt: string;

  /** Maps sessionId → AI Foundry agent + thread state */
  private readonly agentStates = new Map<string, AgentState>();

  /** Tracks knowledge chunks saved during a session */
  private readonly sessionChunks = new Map<string, KnowledgeChunk[]>();
  /** Tracks entities extracted during a session */
  private readonly sessionEntities = new Map<string, EntityMention[]>();

  constructor(options: {
    projectEndpoint: string;
    cosmosClient: CosmosNoSqlClient;
  }) {
    this.projectClient = new AIProjectClient(
      options.projectEndpoint,
      new DefaultAzureCredential(),
    );
    this.cosmosClient = options.cosmosClient;
    this.sessionManager = new SessionManager(options.cosmosClient);
    this.questionGenerator = new QuestionGenerator(
      options.projectEndpoint,
      'gpt-4o',
    );

    this.systemPrompt = this.loadSystemPrompt();

    logger.info('InterviewAgent initialised', {
      component: 'InterviewAgent',
    });
  }

  // ── Public API ──

  /**
   * Start a new interview session (or resume if one is in progress).
   */
  async startSession(
    retireeId: string,
    focusDomains?: string[],
  ): Promise<{ session: InterviewSession; openingMessage: string }> {
    const tracker = new TopicTracker(retireeId, this.cosmosClient);

    // Determine domains to focus on
    const domains = focusDomains?.length
      ? focusDomains
      : [(await tracker.suggestNextFocus()).domain];

    // Create the session
    const session = await this.sessionManager.createSession(retireeId, domains);
    this.sessionChunks.set(session.id, []);
    this.sessionEntities.set(session.id, []);

    // Set up the AI agent and thread
    await this.ensureAgentState(session.id);

    // Build opening message
    const retiree = await this.getRetireeProfile(retireeId);
    const recentSessions = await this.sessionManager.getRecentSessions(retireeId, 3);

    const previousSummary = recentSessions.length > 0
      ? `In our last session we covered: ${recentSessions
          .filter((s) => s.id !== session.id)
          .map((s) => s.focusDomains.join(', '))
          .join('; ')}.`
      : 'This is our first session together.';

    const openingMessage = sessionOpeningTemplate
      .replace('{{retiree_name}}', retiree?.name ?? 'there')
      .replace('{{session_number}}', String(session.sessionNumber))
      .replace('{{focus_domains}}', domains.join(', '))
      .replace('{{previous_summary}}', previousSummary);

    logger.info('Session started', {
      component: 'InterviewAgent',
      operation: 'startSession',
      correlationId: session.id,
      retireeId,
      domains: domains.join(','),
    });

    return { session, openingMessage };
  }

  /**
   * Process a retiree's message and return the agent's response along with
   * any knowledge chunks and entities extracted.
   */
  async handleMessage(
    sessionId: string,
    retireeId: string,
    message: string,
  ): Promise<{
    response: string;
    knowledgeChunks: KnowledgeChunk[];
    entitiesExtracted: EntityMention[];
  }> {
    const state = await this.ensureAgentState(sessionId);

    // Add the user's message to the thread
    await withRetry(
      () =>
        this.projectClient.agents.messages.create(
          state.threadId,
          'user',
          message,
        ),
      { maxRetries: 2 },
    );

    // Create a run and poll until completion (handles intermediate states)
    let completedRun: ThreadRun = await withRetry(async () => {
      const poller = this.projectClient.agents.runs.createAndPoll(
        state.threadId,
        state.agentId,
      );
      return poller.pollUntilDone();
    }, { maxRetries: 2 });

    // Handle tool calls in a loop
    while (completedRun.status === 'requires_action') {
      const requiredAction = completedRun.requiredAction;
      if (!requiredAction || requiredAction.type !== 'submit_tool_outputs') break;

      const toolCalls = (requiredAction as SubmitToolOutputsAction).submitToolOutputs.toolCalls;
      const toolOutputs: ToolOutput[] = [];
      for (const toolCall of toolCalls) {
        if (toolCall.type === 'function') {
          const fnCall = toolCall as RequiredFunctionToolCall;
          const args = JSON.parse(fnCall.function.arguments) as Record<string, unknown>;
          const result = await this.handleToolCall(fnCall.function.name, {
            ...args,
            _sessionId: sessionId,
            _retireeId: retireeId,
          });
          toolOutputs.push({ toolCallId: fnCall.id, output: result });
        }
      }

      // Submit tool outputs and await the resulting run
      const submitResponse = this.projectClient.agents.runs.submitToolOutputs(
        state.threadId,
        completedRun.id,
        toolOutputs,
      );
      completedRun = await submitResponse;
    }

    if (completedRun.status === 'failed') {
      logger.error('Agent run failed', {
        component: 'InterviewAgent',
        operation: 'handleMessage',
        correlationId: sessionId,
        error: completedRun.lastError
          ? new Error(JSON.stringify(completedRun.lastError))
          : undefined,
      });
      throw new AzureServiceError(
        'AIFoundry',
        'handleMessage',
        `Agent run failed: ${JSON.stringify(completedRun.lastError)}`,
        { sessionId },
      );
    }

    // Retrieve the assistant's latest message by iterating the paged list
    const messagesIter = this.projectClient.agents.messages.list(state.threadId);
    let latestAssistantMessage: ThreadMessage | undefined;
    for await (const msg of messagesIter) {
      if (msg.role === 'assistant') {
        latestAssistantMessage = msg;
        break;
      }
    }

    let response = '';
    if (latestAssistantMessage?.content) {
      for (const block of latestAssistantMessage.content) {
        if (block.type === 'text') {
          response += (block as MessageTextContent).text.value;
        }
      }
    }

    // Update session with new question/response
    const session = await this.sessionManager.getSession(sessionId, retireeId);
    session.questionsAsked.push({
      id: uuidv4(),
      text: message,
      generationLayer: 'adaptive',
      domain: session.focusDomains[0] ?? 'general',
      response,
      followUps: [],
      entitiesMentioned: this.sessionEntities.get(sessionId) ?? [],
      completeness: 'needs_follow_up',
    });
    await this.sessionManager.updateSession(session);

    const chunks = this.sessionChunks.get(sessionId) ?? [];
    const entities = this.sessionEntities.get(sessionId) ?? [];

    // Reset per-message accumulators
    this.sessionChunks.set(sessionId, []);
    this.sessionEntities.set(sessionId, []);

    return { response, knowledgeChunks: chunks, entitiesExtracted: entities };
  }

  /**
   * End the current session and produce a summary.
   */
  async endSession(
    sessionId: string,
    retireeId: string,
  ): Promise<{
    summary: string;
    chunksProduced: number;
    coverageDelta: number;
    nextSessionSuggestion: string;
  }> {
    const session = await this.sessionManager.completeSession(sessionId, retireeId);
    const tracker = new TopicTracker(retireeId, this.cosmosClient);
    const nextFocus = await tracker.suggestNextFocus();

    const coverageDelta = (session.coverageAfter ?? session.coverageBefore) - session.coverageBefore;

    const summary = [
      `Session ${session.sessionNumber} complete.`,
      `Domains covered: ${session.focusDomains.join(', ')}.`,
      `Knowledge chunks captured: ${session.knowledgeChunksProduced.length}.`,
      `Coverage change: +${coverageDelta}%.`,
    ].join(' ');

    // Clean up agent state
    await this.cleanupAgentState(sessionId);

    logger.info('Session ended', {
      component: 'InterviewAgent',
      operation: 'endSession',
      correlationId: sessionId,
      chunksProduced: String(session.knowledgeChunksProduced.length),
      coverageDelta: String(coverageDelta),
    });

    return {
      summary,
      chunksProduced: session.knowledgeChunksProduced.length,
      coverageDelta,
      nextSessionSuggestion: `Next session suggestion: focus on "${nextFocus.domain}" — ${nextFocus.reason}`,
    };
  }

  /**
   * Return the function tool definitions the AI Foundry agent uses.
   */
  getToolDefinitions(): FunctionToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  /**
   * Handle a function tool call made by the AI agent.
   */
  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    logger.debug('Handling tool call', {
      component: 'InterviewAgent',
      operation: 'handleToolCall',
      toolName: name,
    });

    switch (name) {
      case 'get_observation_summary':
        return this.toolGetObservationSummary(args['retiree_id'] as string);

      case 'get_coverage_gaps':
        return this.toolGetCoverageGaps(args['retiree_id'] as string);

      case 'save_knowledge_chunk':
        return this.toolSaveKnowledgeChunk(args);

      case 'get_session_history':
        return this.toolGetSessionHistory(
          args['retiree_id'] as string,
          args['last_n'] as number | undefined,
        );

      default:
        logger.warn('Unknown tool call', {
          component: 'InterviewAgent',
          toolName: name,
        });
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  }

  // ── Tool implementations ──

  private async toolGetObservationSummary(retireeId: string): Promise<string> {
    try {
      const observations = await this.cosmosClient.query<Record<string, unknown>>(
        'observations',
        {
          query: 'SELECT * FROM c WHERE c.retireeId = @retireeId',
          parameters: [{ name: '@retireeId', value: retireeId }],
        },
      );
      return JSON.stringify({ observations: observations.slice(0, 10) });
    } catch (error) {
      logger.error('Failed to get observation summary', {
        component: 'InterviewAgent',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return JSON.stringify({ observations: [], error: 'Failed to retrieve observations' });
    }
  }

  private async toolGetCoverageGaps(retireeId: string): Promise<string> {
    const tracker = new TopicTracker(retireeId, this.cosmosClient);
    const gaps = await tracker.getGapAnalysis();
    const covered = Object.fromEntries(await tracker.getCoveredTopics());
    return JSON.stringify({ coveredTopics: covered, gaps });
  }

  private async toolSaveKnowledgeChunk(args: Record<string, unknown>): Promise<string> {
    const retireeId = args['retiree_id'] as string;
    const sessionId = args['_sessionId'] as string | undefined;

    const rawEntities = Array.isArray(args['entities']) ? args['entities'] as Array<Record<string, unknown>> : [];
    const entities: EntityMention[] = rawEntities.map((e) => ({
      entityId: uuidv4(),
      text: String(e['text'] ?? ''),
      type: (String(e['type'] ?? 'Process')) as EntityMention['type'],
      confidence: typeof e['confidence'] === 'number' ? e['confidence'] : 0.5,
    }));

    const chunk: KnowledgeChunk & Record<string, unknown> = {
      id: uuidv4(),
      content: String(args['content'] ?? ''),
      summary: String(args['summary'] ?? ''),
      knowledgeType: (String(args['knowledge_type'] ?? 'explicit')) as KnowledgeChunk['knowledgeType'],
      domainId: String(args['domain'] ?? 'general'),
      retireeId,
      source: {
        type: 'interview',
        sourceId: sessionId ?? 'unknown',
        timestamp: new Date(),
      },
      entities,
      qualityScore: {
        overall: 0.7,
        completeness: 0.7,
        specificity: 0.7,
        uniqueness: 0.7,
        actionability: 0.7,
        recency: 1.0,
      },
      sensitivityLevel: (String(args['sensitivity'] ?? 'internal')) as KnowledgeChunk['sensitivityLevel'],
      consentId: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.cosmosClient.create('knowledgeChunks', chunk, retireeId);

    // Track in-session state
    if (sessionId) {
      const chunks = this.sessionChunks.get(sessionId) ?? [];
      chunks.push(chunk);
      this.sessionChunks.set(sessionId, chunks);

      const allEntities = this.sessionEntities.get(sessionId) ?? [];
      allEntities.push(...entities);
      this.sessionEntities.set(sessionId, allEntities);

      // Update session's chunk list
      try {
        const session = await this.sessionManager.getSession(
          sessionId,
          retireeId,
        );
        session.knowledgeChunksProduced.push(chunk.id);
        await this.sessionManager.updateSession(session);
      } catch {
        // Non-fatal: chunk is saved even if session update fails
        logger.warn('Could not update session chunk list', {
          component: 'InterviewAgent',
          correlationId: sessionId,
        });
      }
    }

    logger.info('Knowledge chunk saved', {
      component: 'InterviewAgent',
      operation: 'save_knowledge_chunk',
      chunkId: chunk.id,
      domain: chunk.domainId,
    });

    return JSON.stringify({ saved: true, chunkId: chunk.id });
  }

  private async toolGetSessionHistory(
    retireeId: string,
    lastN?: number,
  ): Promise<string> {
    const sessions = await this.sessionManager.getSessionHistory(retireeId, lastN);
    const summaries = sessions.map((s) => ({
      sessionNumber: s.sessionNumber,
      date: s.startedAt,
      domains: s.focusDomains,
      questionsCount: s.questionsAsked.length,
      chunksProduced: s.knowledgeChunksProduced.length,
      status: s.status,
    }));
    return JSON.stringify({ sessions: summaries });
  }

  // ── Agent lifecycle helpers ──

  private async ensureAgentState(sessionId: string): Promise<AgentState> {
    const existing = this.agentStates.get(sessionId);
    if (existing) return existing;

    const agent = await withRetry(
      () =>
        this.projectClient.agents.createAgent('gpt-4o', {
          name: `interview-agent-${sessionId}`,
          instructions: this.systemPrompt,
          tools: TOOL_DEFINITIONS,
        }),
      { maxRetries: 2 },
    );

    const thread = await withRetry(
      () => this.projectClient.agents.threads.create(),
      { maxRetries: 2 },
    );

    const state: AgentState = {
      agentId: agent.id,
      threadId: thread.id,
    };

    this.agentStates.set(sessionId, state);

    logger.debug('Agent state created', {
      component: 'InterviewAgent',
      correlationId: sessionId,
      agentId: agent.id,
      threadId: thread.id,
    });

    return state;
  }

  private async cleanupAgentState(sessionId: string): Promise<void> {
    const state = this.agentStates.get(sessionId);
    if (!state) return;

    try {
      await this.projectClient.agents.deleteAgent(state.agentId);
    } catch (error) {
      logger.warn('Failed to clean up agent', {
        component: 'InterviewAgent',
        correlationId: sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.agentStates.delete(sessionId);
    this.sessionChunks.delete(sessionId);
    this.sessionEntities.delete(sessionId);
  }

  private loadSystemPrompt(): string {
    const promptPath = path.join(__dirname, 'prompts', 'system-prompt.md');
    try {
      return fs.readFileSync(promptPath, 'utf-8');
    } catch (error) {
      logger.error('Failed to load system prompt', {
        component: 'InterviewAgent',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return 'You are a knowledge transfer interview agent. Capture institutional knowledge from the retiring employee.';
    }
  }

  private async getRetireeProfile(retireeId: string): Promise<RetireeProfile | null> {
    try {
      return await this.cosmosClient.read<RetireeProfile>(
        'retirees',
        retireeId,
        retireeId,
      );
    } catch (error) {
      if (error instanceof EntityNotFoundError) return null;
      throw error;
    }
  }
}
