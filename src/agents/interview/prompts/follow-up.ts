// ──────────────────────────────────────────────
// Follow-up question generation utilities
// ──────────────────────────────────────────────

import type { InterviewQuestion, EntityMention } from '../../../shared/types.js';
import { logger } from '../../../shared/logger.js';
import { adaptiveFollowUpPrompt } from './question-templates.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Build the prompt string that is sent to the LLM to generate adaptive
 * follow-up questions based on what the retiree just said.
 */
export function generateFollowUpPrompt(
  response: string,
  detectedEntities: EntityMention[],
  currentDomain: string,
  topicsCovered: string[],
): string {
  const entitiesStr = detectedEntities.length > 0
    ? detectedEntities.map((e) => `${e.text} (${e.type}, confidence: ${e.confidence})`).join('\n')
    : 'None detected';

  const topicsStr = topicsCovered.length > 0
    ? topicsCovered.join(', ')
    : 'None yet';

  return adaptiveFollowUpPrompt
    .replace('{{response}}', response)
    .replace('{{entities}}', entitiesStr)
    .replace('{{domain}}', currentDomain)
    .replace('{{topics_covered}}', topicsStr);
}

/** Shape of a single follow-up in the raw LLM JSON output. */
interface RawFollowUp {
  text?: string;
  domain?: string;
  generationLayer?: string;
  completeness?: string;
  entitiesMentioned?: Array<{
    text?: string;
    type?: string;
    confidence?: number;
  }>;
}

/**
 * Parse the LLM's JSON response into strongly-typed `InterviewQuestion[]`.
 * Tolerates minor formatting issues (markdown fences, trailing commas).
 */
export function parseFollowUpResponse(llmResponse: string): InterviewQuestion[] {
  try {
    // Strip markdown code fences if present
    let cleaned = llmResponse.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const parsed: unknown = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      logger.warn('Follow-up response is not an array, wrapping', {
        component: 'FollowUp',
      });
      return [];
    }

    return (parsed as RawFollowUp[])
      .filter((item): item is RawFollowUp => typeof item === 'object' && item !== null && typeof item.text === 'string')
      .map((item) => ({
        id: uuidv4(),
        text: item.text as string,
        generationLayer: 'adaptive' as const,
        domain: typeof item.domain === 'string' ? item.domain : 'unknown',
        followUps: [],
        entitiesMentioned: Array.isArray(item.entitiesMentioned)
          ? item.entitiesMentioned
              .filter((e): e is { text: string; type: string; confidence: number } =>
                typeof e === 'object' && e !== null && typeof e.text === 'string')
              .map((e) => ({
                entityId: uuidv4(),
                text: e.text,
                type: (e.type ?? 'Process') as EntityMention['type'],
                confidence: typeof e.confidence === 'number' ? e.confidence : 0.5,
              }))
          : [],
        completeness: (item.completeness === 'complete' ? 'complete' : 'needs_follow_up') as InterviewQuestion['completeness'],
      }));
  } catch (error) {
    logger.error('Failed to parse follow-up response from LLM', {
      component: 'FollowUp',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return [];
  }
}
