// Classify sensitivity level of knowledge chunks

import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { logger } from '../shared/logger.js';
import { AzureServiceError } from '../shared/errors.js';
import { withRetry } from '../shared/retry.js';
import type { EntityMention } from '../shared/types.js';

type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'highly_confidential';

const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

// Regex patterns for quick classification
const HIGHLY_CONFIDENTIAL_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,                               // SSN
  /\b(?:password|passwd|secret)\s*[:=]\s*\S+/i,           // Passwords
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,         // Credit card numbers
  /\b(?:private key|secret key|api[_\s]?key)\s*[:=]/i,    // Secrets/keys
  /\b(?:salary|compensation|pay grade)\s*[:=]?\s*\$?\d/i, // Salary data
];

const CONFIDENTIAL_PATTERNS = [
  /\b(?:confidential|proprietary|trade secret|nda)\b/i,
  /\b(?:revenue|profit|loss|margin|forecast)\s*[:=]?\s*\$?\d/i,
  /\b(?:acquisition|merger|layoff|restructur)/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i,   // Email addresses
  /\b(?:home address|phone number|date of birth|DOB)\b/i, // PII indicators
];

const CLASSIFICATION_PROMPT = `You are a data classification expert. Classify the sensitivity level of the following text.

Sensitivity levels:
- public: General knowledge safe for anyone, no PII or business-sensitive data
- internal: Standard business information, not harmful if shared within the organization
- confidential: Contains PII, financial details, strategic plans, or information covered by NDA
- highly_confidential: Contains credentials, SSNs, detailed financial data, or information that could cause significant harm if leaked

Consider:
1. Does it contain personal identifiable information (PII)?
2. Does it contain financial data or business-sensitive metrics?
3. Does it reference security credentials, passwords, or keys?
4. Does it contain strategic or competitive information?
5. Could disclosure cause harm to individuals or the organization?

Respond with ONLY one of: public, internal, confidential, highly_confidential`;

export class SensitivityClassifier {
  private client: AzureOpenAI;
  private deploymentName: string;

  constructor(endpoint: string, deploymentName: string) {
    this.deploymentName = deploymentName;

    const credential = new DefaultAzureCredential();
    const azureADTokenProvider = getBearerTokenProvider(credential, AZURE_OPENAI_SCOPE);

    this.client = new AzureOpenAI({
      endpoint,
      azureADTokenProvider,
      apiVersion: '2024-06-01',
    });
  }

  async classify(text: string, entities: EntityMention[]): Promise<SensitivityLevel> {
    // Try rule-based check first
    const quickResult = this.quickCheck(text);
    if (quickResult) {
      logger.debug('Sensitivity classified via quick check', {
        component: 'SensitivityClassifier',
        level: quickResult,
      });
      return quickResult;
    }

    // Fall back to LLM classification
    logger.debug('Classifying sensitivity via LLM', {
      component: 'SensitivityClassifier',
      textLength: String(text.length),
      entityCount: String(entities.length),
    });

    try {
      const entityContext = entities.length > 0
        ? `\n\nEntities found: ${entities.map((e) => `${e.type}:${e.text}`).join(', ')}`
        : '';

      const result = await withRetry(
        async () => {
          const response = await this.client.chat.completions.create({
            model: this.deploymentName,
            messages: [
              { role: 'system', content: CLASSIFICATION_PROMPT },
              { role: 'user', content: text + entityContext },
            ],
            max_tokens: 20,
            temperature: 0,
          });

          return response.choices[0]?.message?.content?.trim().toLowerCase() ?? '';
        },
        { maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 10_000, jitter: true },
      );

      if (isValidSensitivityLevel(result)) {
        return result;
      }

      // Default to 'internal' if uncertain
      logger.warn('LLM returned unexpected sensitivity level, defaulting to internal', {
        component: 'SensitivityClassifier',
        rawResult: result,
      });
      return 'internal';
    } catch (error) {
      logger.error('Sensitivity classification failed, defaulting to internal', {
        component: 'SensitivityClassifier',
        error: error instanceof Error ? error : undefined,
      });
      return 'internal';
    }
  }

  quickCheck(text: string): SensitivityLevel | null {
    // Check for highly confidential patterns first
    for (const pattern of HIGHLY_CONFIDENTIAL_PATTERNS) {
      if (pattern.test(text)) {
        return 'highly_confidential';
      }
    }

    // Check for confidential patterns
    for (const pattern of CONFIDENTIAL_PATTERNS) {
      if (pattern.test(text)) {
        return 'confidential';
      }
    }

    // Rule-based check cannot determine public vs internal — return null for LLM
    return null;
  }
}

function isValidSensitivityLevel(value: string): value is SensitivityLevel {
  return ['public', 'internal', 'confidential', 'highly_confidential'].includes(value);
}
