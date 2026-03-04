import { describe, it, expect } from 'vitest';
import { buildAnswerCard } from '../../../../src/bot/cards/answer-card.js';
import type { AgentResponse } from '../../../../src/shared/types.js';

function makeResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    queryId: 'q-001',
    answer: 'For quality issues with Acme Corp, escalate to Mark Rodriguez.',
    confidence: 0.85,
    sources: [
      {
        type: 'interview',
        sourceId: 'chunk-001',
        title: 'Vendor Management Overview',
        relevance: 0.92,
        timestamp: new Date('2025-03-01'),
        retiree: 'Robert Thompson',
      },
    ],
    coverage: 'complete',
    followUps: [
      'What is the escalation timeline?',
      'Who handles billing issues?',
    ],
    processingTimeMs: 1200,
    ...overrides,
  };
}

describe('buildAnswerCard', () => {
  describe('card structure', () => {
    it('should return a valid Adaptive Card with required elements', () => {
      const card = buildAnswerCard(makeResponse()) as Record<string, unknown>;

      expect(card['$schema']).toBe('http://adaptivecards.io/schemas/adaptive-card.json');
      expect(card['type']).toBe('AdaptiveCard');
      expect(card['version']).toBe('1.5');
      expect(card['body']).toBeDefined();
      expect(Array.isArray(card['body'])).toBe(true);
      expect(card['actions']).toBeDefined();
      expect(Array.isArray(card['actions'])).toBe(true);
    });

    it('should include answer text block in body', () => {
      const card = buildAnswerCard(makeResponse()) as Record<string, unknown>;
      const body = card['body'] as Array<Record<string, unknown>>;

      const textBlock = body.find((b) => b['type'] === 'TextBlock');
      expect(textBlock).toBeDefined();
      expect(textBlock!['text']).toContain('Acme Corp');
      expect(textBlock!['wrap']).toBe(true);
    });

    it('should include confidence and coverage in a ColumnSet', () => {
      const card = buildAnswerCard(makeResponse()) as Record<string, unknown>;
      const body = card['body'] as Array<Record<string, unknown>>;

      const columnSet = body.find((b) => b['type'] === 'ColumnSet');
      expect(columnSet).toBeDefined();

      const columns = columnSet!['columns'] as Array<Record<string, unknown>>;
      expect(columns.length).toBe(2);

      // Confidence column
      const confItems = columns[0]['items'] as Array<Record<string, unknown>>;
      const confText = confItems[0]['text'] as string;
      expect(confText).toContain('Confidence');

      // Coverage column
      const covItems = columns[1]['items'] as Array<Record<string, unknown>>;
      const covText = covItems[0]['text'] as string;
      expect(covText).toContain('Coverage');
    });
  });

  describe('confidence emoji mapping', () => {
    it('should show green emoji for high confidence (>= 0.7)', () => {
      const card = buildAnswerCard(makeResponse({ confidence: 0.85 })) as Record<string, unknown>;
      const body = card['body'] as Array<Record<string, unknown>>;
      const columnSet = body.find((b) => b['type'] === 'ColumnSet') as Record<string, unknown>;
      const columns = columnSet['columns'] as Array<Record<string, unknown>>;
      const confItems = columns[0]['items'] as Array<Record<string, unknown>>;
      const text = confItems[0]['text'] as string;

      expect(text).toContain('🟢 High');
    });

    it('should show yellow emoji for medium confidence (0.4-0.7)', () => {
      const card = buildAnswerCard(makeResponse({ confidence: 0.55 })) as Record<string, unknown>;
      const body = card['body'] as Array<Record<string, unknown>>;
      const columnSet = body.find((b) => b['type'] === 'ColumnSet') as Record<string, unknown>;
      const columns = columnSet['columns'] as Array<Record<string, unknown>>;
      const confItems = columns[0]['items'] as Array<Record<string, unknown>>;
      const text = confItems[0]['text'] as string;

      expect(text).toContain('🟡 Medium');
    });

    it('should show red emoji for low confidence (< 0.4)', () => {
      const card = buildAnswerCard(makeResponse({ confidence: 0.2 })) as Record<string, unknown>;
      const body = card['body'] as Array<Record<string, unknown>>;
      const columnSet = body.find((b) => b['type'] === 'ColumnSet') as Record<string, unknown>;
      const columns = columnSet['columns'] as Array<Record<string, unknown>>;
      const confItems = columns[0]['items'] as Array<Record<string, unknown>>;
      const text = confItems[0]['text'] as string;

      expect(text).toContain('🔴 Low');
    });
  });

  describe('sources section', () => {
    it('should include sources action when sources exist', () => {
      const card = buildAnswerCard(makeResponse()) as Record<string, unknown>;
      const body = card['body'] as Array<Record<string, unknown>>;

      const actionSet = body.find((b) => b['type'] === 'ActionSet');
      expect(actionSet).toBeDefined();

      const actions = actionSet!['actions'] as Array<Record<string, unknown>>;
      const showCard = actions.find((a) => a['type'] === 'Action.ShowCard');
      expect(showCard).toBeDefined();
      expect(showCard!['title']).toContain('Sources');
      expect(showCard!['title']).toContain('1');
    });

    it('should not include sources section when no sources exist', () => {
      const card = buildAnswerCard(makeResponse({ sources: [] })) as Record<string, unknown>;
      const body = card['body'] as Array<Record<string, unknown>>;

      const actionSet = body.find((b) => b['type'] === 'ActionSet');
      expect(actionSet).toBeUndefined();
    });

    it('should include FactSet for each source', () => {
      const response = makeResponse({
        sources: [
          { type: 'interview', sourceId: 'c1', title: 'Source 1', relevance: 0.9, timestamp: new Date(), retiree: 'Retiree A' },
          { type: 'document', sourceId: 'c2', title: 'Source 2', relevance: 0.7, timestamp: new Date(), retiree: 'Retiree B' },
        ],
      });
      const card = buildAnswerCard(response) as Record<string, unknown>;
      const body = card['body'] as Array<Record<string, unknown>>;
      const actionSet = body.find((b) => b['type'] === 'ActionSet') as Record<string, unknown>;
      const actions = actionSet['actions'] as Array<Record<string, unknown>>;
      const showCard = actions[0] as Record<string, unknown>;
      const innerCard = showCard['card'] as Record<string, unknown>;
      const innerBody = innerCard['body'] as Array<Record<string, unknown>>;

      expect(innerBody.length).toBe(2);
      expect(innerBody[0]['type']).toBe('FactSet');
    });
  });

  describe('follow-up buttons', () => {
    it('should generate Action.Submit buttons for follow-up questions', () => {
      const card = buildAnswerCard(makeResponse()) as Record<string, unknown>;
      const actions = card['actions'] as Array<Record<string, unknown>>;

      const followUps = actions.filter(
        (a) => a['type'] === 'Action.Submit' && (a['data'] as Record<string, unknown>)?.['type'] === 'follow_up_query',
      );

      expect(followUps.length).toBe(2);
      expect(followUps[0]['title']).toBe('What is the escalation timeline?');
      expect((followUps[0]['data'] as Record<string, unknown>)['query']).toBe('What is the escalation timeline?');
    });

    it('should have no follow-up buttons when followUps is empty', () => {
      const card = buildAnswerCard(makeResponse({ followUps: [] })) as Record<string, unknown>;
      const actions = card['actions'] as Array<Record<string, unknown>>;

      const followUps = actions.filter(
        (a) => (a['data'] as Record<string, unknown>)?.['type'] === 'follow_up_query',
      );
      expect(followUps.length).toBe(0);
    });
  });

  describe('feedback buttons', () => {
    it('should include thumbs up and thumbs down feedback buttons', () => {
      const card = buildAnswerCard(makeResponse()) as Record<string, unknown>;
      const actions = card['actions'] as Array<Record<string, unknown>>;

      const feedbackButtons = actions.filter(
        (a) => (a['data'] as Record<string, unknown>)?.['type'] === 'feedback',
      );

      expect(feedbackButtons.length).toBe(2);

      const positiveBtn = feedbackButtons.find(
        (b) => (b['data'] as Record<string, unknown>)['value'] === 'positive',
      );
      const negativeBtn = feedbackButtons.find(
        (b) => (b['data'] as Record<string, unknown>)['value'] === 'negative',
      );

      expect(positiveBtn).toBeDefined();
      expect(positiveBtn!['title']).toBe('👍');
      expect(negativeBtn).toBeDefined();
      expect(negativeBtn!['title']).toBe('👎');
    });

    it('should include queryId in feedback button data', () => {
      const card = buildAnswerCard(makeResponse({ queryId: 'q-test-123' })) as Record<string, unknown>;
      const actions = card['actions'] as Array<Record<string, unknown>>;

      const feedbackButtons = actions.filter(
        (a) => (a['data'] as Record<string, unknown>)?.['type'] === 'feedback',
      );

      for (const btn of feedbackButtons) {
        expect((btn['data'] as Record<string, unknown>)['queryId']).toBe('q-test-123');
      }
    });
  });
});
