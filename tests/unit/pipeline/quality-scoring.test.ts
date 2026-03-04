import { describe, it, expect } from 'vitest';
import { QualityScorer } from '../../../src/pipeline/quality-scoring.js';
import type { EntityMention } from '../../../src/shared/types.js';

describe('QualityScorer', () => {
  const scorer = new QualityScorer();

  function makeEntities(...specs: Array<[string, EntityMention['type']]>): EntityMention[] {
    return specs.map(([text, type], i) => ({
      entityId: `e${i}`,
      text,
      type,
      confidence: 0.9,
    }));
  }

  describe('high-quality chunk scoring', () => {
    it('should produce high scores for specific, entity-rich content', () => {
      const chunk = {
        content:
          'Contact Sarah Chen at Acme Corp for quality issues. She manages the vendor relationship since January 2023. ' +
          'Step 1: File a ticket in the Procurement Dashboard. Step 2: Escalate to Mark Rodriguez if unresolved within 48 hours. ' +
          'The team processes around 150 tickets monthly through this system. The workaround for urgent cases is to call the VP directly.',
        entities: makeEntities(
          ['Sarah Chen', 'Person'],
          ['Acme Corp', 'Vendor'],
          ['Procurement Dashboard', 'System'],
          ['Mark Rodriguez', 'Person'],
          ['ticket escalation', 'Process'],
        ),
        source: { type: 'interview' as const, timestamp: new Date() },
      };

      const score = scorer.score(chunk);

      expect(score.overall).toBeGreaterThan(0.5);
      expect(score.completeness).toBeGreaterThan(0.3);
      expect(score.specificity).toBeGreaterThan(0.2);
      expect(score.actionability).toBeGreaterThan(0.2);
    });
  });

  describe('low-quality chunk scoring', () => {
    it('should produce low scores for vague, entity-free content', () => {
      const chunk = {
        content:
          'Sometimes things happen and stuff needs to be handled. ' +
          'Generally people should probably talk to someone about it. ' +
          'It sort of depends on the situation.',
        entities: [],
        source: { type: 'interview' as const, timestamp: new Date() },
      };

      const score = scorer.score(chunk);

      expect(score.overall).toBeLessThan(0.5);
      expect(score.uniqueness).toBeLessThan(0.3);
      // Vague language should penalize specificity
      expect(score.specificity).toBeLessThan(0.3);
    });
  });

  describe('overall score weighted average', () => {
    it('should compute overall as weighted average of dimensions', () => {
      const chunk = {
        content:
          'The monthly report process runs on the first Tuesday. Contact Janet Williams in Finance for budget questions. ' +
          'Use the Budget Portal system to submit forecasts by the 15th.',
        entities: makeEntities(
          ['Janet Williams', 'Person'],
          ['Budget Portal', 'System'],
          ['monthly report', 'Process'],
        ),
        source: { type: 'interview' as const, timestamp: new Date() },
      };

      const score = scorer.score(chunk);

      // Overall should be between 0 and 1
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(1);

      // Verify the weighted average formula (approximately):
      // overall = completeness*0.25 + specificity*0.25 + uniqueness*0.15 + actionability*0.20 + recency*0.15
      const expectedWeighted =
        score.completeness * 0.25 +
        score.specificity * 0.25 +
        score.uniqueness * 0.15 +
        score.actionability * 0.20 +
        score.recency * 0.15;

      // Should be close (clamped to [0,1])
      const clamped = Math.max(0, Math.min(1, expectedWeighted));
      expect(score.overall).toBeCloseTo(clamped, 5);
    });
  });

  describe('individual dimension scoring', () => {
    it('should score completeness higher with entities and action verbs', () => {
      const withEntities = scorer.score({
        content: 'The system should process the data when the threshold is exceeded. This happens daily in the department.',
        entities: makeEntities(['DataSystem', 'System'], ['processing', 'Process'], ['threshold rule', 'Decision']),
        source: { type: 'interview' as const },
      });

      const withoutEntities = scorer.score({
        content: 'The system should process the data when the threshold is exceeded. This happens daily in the department.',
        entities: [],
        source: { type: 'interview' as const },
      });

      expect(withEntities.completeness).toBeGreaterThan(withoutEntities.completeness);
    });

    it('should score specificity higher when content has dates and steps', () => {
      const specific = scorer.score({
        content: 'On January 15, run Step 1 of the migration at v2.3. The server at 10.0.1.50 handles 500 requests per second.',
        entities: [],
        source: { type: 'interview' as const },
      });

      const vague = scorer.score({
        content: 'Sometimes things happen and stuff needs to be handled generally.',
        entities: [],
        source: { type: 'interview' as const },
      });

      expect(specific.specificity).toBeGreaterThan(vague.specificity);
    });

    it('should score uniqueness higher with diverse entity types and workarounds', () => {
      const unique = scorer.score({
        // ~20 words, 5 entities = entity density 0.25 > 0.05 threshold
        content: 'Contact Sarah at Acme Corp about the procurement workaround for the budget decision on the legacy system.',
        entities: makeEntities(
          ['Sarah', 'Person'],
          ['Acme Corp', 'Vendor'],
          ['procurement workaround', 'Workaround'],
          ['budget decision', 'Decision'],
          ['legacy system', 'System'],
        ),
        source: { type: 'interview' as const },
      });

      const generic = scorer.score({
        content: 'We do things a certain way around here.',
        entities: [],
        source: { type: 'interview' as const },
      });

      expect(unique.uniqueness).toBeGreaterThan(generic.uniqueness);
    });

    it('should score actionability higher with procedural content', () => {
      const actionable = scorer.score({
        content:
          'Step 1: Open the admin console. Step 2: Navigate to settings and configure the threshold. ' +
          'If the value exceeds the criteria, then escalate to the operations team. Contact support@example.com for help.',
        entities: [],
        source: { type: 'interview' as const },
      });

      const nonActionable = scorer.score({
        content: 'The history of vendor management goes back many decades and has evolved significantly.',
        entities: [],
        source: { type: 'interview' as const },
      });

      expect(actionable.actionability).toBeGreaterThan(nonActionable.actionability);
    });

    it('should score recency higher for recent timestamps', () => {
      const recent = scorer.score({
        content: 'Some content.',
        entities: [],
        source: { type: 'interview' as const, timestamp: new Date() },
      });

      const old = scorer.score({
        content: 'Some content.',
        entities: [],
        source: { type: 'interview' as const, timestamp: new Date('2020-01-01') },
      });

      expect(recent.recency).toBeGreaterThan(old.recency);
    });

    it('should default recency to 0.5 when no timestamp is provided', () => {
      const score = scorer.score({
        content: 'Some content.',
        entities: [],
        source: { type: 'interview' as const },
      });

      expect(score.recency).toBe(0.5);
    });
  });
});
