// ──────────────────────────────────────────────
// Multi-layer interview question generator
// ──────────────────────────────────────────────

import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import { v4 as uuidv4 } from 'uuid';
import type {
  InterviewQuestion,
  InterviewSession,
  EntityMention,
} from '../../shared/types.js';
import { logger } from '../../shared/logger.js';
import { withRetry } from '../../shared/retry.js';
import { AzureServiceError } from '../../shared/errors.js';
import { questionTemplates } from './prompts/question-templates.js';
import { generateFollowUpPrompt, parseFollowUpResponse } from './prompts/follow-up.js';

type OpenAIClient = Awaited<ReturnType<AIProjectClient['getAzureOpenAIClient']>>;

export class QuestionGenerator {
  private readonly projectClient: AIProjectClient;
  private readonly deploymentName: string;
  private openaiClient: OpenAIClient | undefined;

  constructor(openaiEndpoint: string, deploymentName: string) {
    this.projectClient = new AIProjectClient(
      openaiEndpoint,
      new DefaultAzureCredential(),
    );
    this.deploymentName = deploymentName;
    logger.info('QuestionGenerator initialised', {
      component: 'QuestionGenerator',
      deploymentName,
    });
  }

  // ── Layer 1: Template-based questions ──

  /**
   * Return questions from the domain template library, with placeholders
   * replaced using the supplied context map.
   */
  getTemplateQuestions(
    domain: string,
    context: Record<string, string>,
  ): string[] {
    const templates = questionTemplates[domain];
    if (!templates) {
      logger.debug('No templates found for domain', {
        component: 'QuestionGenerator',
        domain,
      });
      return [];
    }

    return templates.map((template) => {
      let filled = template;
      for (const [key, value] of Object.entries(context)) {
        filled = filled.replaceAll(`{{${key}}}`, value);
      }
      return filled;
    });
  }

  // ── Layer 2: Observation-informed questions ──

  /**
   * Generate questions informed by prior observation data (email patterns,
   * meeting analysis, etc.) for the retiree in a given domain.
   */
  async getObservationQuestions(
    retireeId: string,
    domain: string,
  ): Promise<string[]> {
    try {
      const prompt = [
        'Based on the following observation context, generate 3 interview questions',
        `for knowledge domain "${domain}" that target gaps in captured knowledge.`,
        `Retiree ID: ${retireeId}`,
        '',
        'Return only a JSON array of question strings.',
      ].join('\n');

      const response = await withRetry(
        () => this.chatCompletion(prompt),
        { maxRetries: 2 },
      );

      return this.parseStringArray(response);
    } catch (error) {
      logger.warn('Failed to generate observation questions, falling back to empty', {
        component: 'QuestionGenerator',
        operation: 'getObservationQuestions',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // ── Layer 3: Adaptive follow-ups ──

  /**
   * Generate follow-up questions based on the retiree's latest response,
   * detected entities, and the current domain context.
   */
  async generateAdaptiveFollowUp(
    response: string,
    entities: EntityMention[],
    domain: string,
  ): Promise<InterviewQuestion[]> {
    try {
      const prompt = generateFollowUpPrompt(response, entities, domain, []);

      const llmResponse = await withRetry(
        () => this.chatCompletion(prompt),
        { maxRetries: 2 },
      );

      return parseFollowUpResponse(llmResponse);
    } catch (error) {
      logger.warn('Adaptive follow-up generation failed', {
        component: 'QuestionGenerator',
        operation: 'generateAdaptiveFollowUp',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // ── Merged question set ──

  /**
   * Merge and prioritise questions from all three layers, deduplicating
   * against questions already asked in prior sessions.
   */
  async generateQuestions(
    retireeId: string,
    domain: string,
    sessionHistory: InterviewSession[],
  ): Promise<InterviewQuestion[]> {
    const alreadyAsked = new Set(
      sessionHistory.flatMap((s) => s.questionsAsked.map((q) => q.text.toLowerCase())),
    );

    // Layer 1 — templates
    const templateQs = this.getTemplateQuestions(domain, {}).map(
      (text) => this.toQuestion(text, domain, 'template'),
    );

    // Layer 2 — observation-informed
    const observationTexts = await this.getObservationQuestions(retireeId, domain);
    const observationQs = observationTexts.map(
      (text) => this.toQuestion(text, domain, 'observation'),
    );

    // Combine and deduplicate
    const allQuestions = [...templateQs, ...observationQs].filter(
      (q) => !alreadyAsked.has(q.text.toLowerCase()),
    );

    logger.info('Questions generated', {
      component: 'QuestionGenerator',
      domain,
      templateCount: String(templateQs.length),
      observationCount: String(observationQs.length),
      afterDedup: String(allQuestions.length),
    });

    return allQuestions;
  }

  // ── Private helpers ──

  private toQuestion(
    text: string,
    domain: string,
    layer: InterviewQuestion['generationLayer'],
  ): InterviewQuestion {
    return {
      id: uuidv4(),
      text,
      generationLayer: layer,
      domain,
      followUps: [],
      entitiesMentioned: [],
      completeness: 'needs_follow_up',
    };
  }

  private async getOpenAIClient(): Promise<OpenAIClient> {
    if (!this.openaiClient) {
      this.openaiClient = await this.projectClient.getAzureOpenAIClient();
    }
    return this.openaiClient;
  }

  private async chatCompletion(prompt: string): Promise<string> {
    try {
      const client = await this.getOpenAIClient();
      const response = await client.chat.completions.create({
        model: this.deploymentName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new AzureServiceError(
          'AzureOpenAI',
          'chatCompletion',
          'Empty response from model',
        );
      }
      return content;
    } catch (error) {
      if (error instanceof AzureServiceError) throw error;
      throw new AzureServiceError(
        'AzureOpenAI',
        'chatCompletion',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private parseStringArray(raw: string): string[] {
    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      const parsed: unknown = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
      return [];
    } catch {
      logger.debug('Could not parse string array from LLM response', {
        component: 'QuestionGenerator',
      });
      return [];
    }
  }
}
