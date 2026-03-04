// Use GPT-4o to classify observed activity into knowledge domains

import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { logger } from '../shared/logger.js';
import { withRetry } from '../shared/retry.js';
import type { EmailAnalysis, DomainClassification } from '../shared/types.js';

export class DomainClassifier {
  private client: AzureOpenAI;
  private deploymentName: string;

  constructor(openaiEndpoint: string, deploymentName: string) {
    this.deploymentName = deploymentName;
    const credential = new DefaultAzureCredential();
    const tokenProvider = getBearerTokenProvider(
      credential,
      'https://cognitiveservices.azure.com/.default',
    );
    this.client = new AzureOpenAI({
      azureADTokenProvider: tokenProvider,
      endpoint: openaiEndpoint,
      apiVersion: '2024-10-21',
    });
  }

  async classifyDomains(
    emailAnalysis: EmailAnalysis,
    calendarData: object,
    documentData: object,
  ): Promise<DomainClassification[]> {
    logger.info('Classifying knowledge domains from observations', {
      component: 'DomainClassifier',
      operation: 'classifyDomains',
      retireeId: emailAnalysis.retireeId,
    });

    const prompt = this.buildPrompt(emailAnalysis, calendarData, documentData);

    const response = await withRetry(
      async () => {
        const result = await this.client.chat.completions.create({
          model: this.deploymentName,
          messages: [
            {
              role: 'system',
              content: `You are an expert at identifying knowledge domains from workplace activity data.
Analyze the provided email patterns, calendar data, and document activity to identify distinct knowledge domains.
Return a JSON array of domain classifications.

Each domain should have:
- domain: short name for the knowledge domain
- parentDomain: optional broader category
- confidence: 0-1 score
- evidence: counts of { emails, meetings, documents, teamsMessages }
- suggestedInterviewQuestions: 2-3 targeted questions to capture this domain knowledge
- gapIndicators: signs that knowledge may be at risk of being lost

Return ONLY valid JSON array, no markdown.`,
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
        });

        return result;
      },
      { maxRetries: 2, baseDelayMs: 2_000 },
    );

    const content = response.choices[0]?.message?.content ?? '{"domains":[]}';

    try {
      const parsed = JSON.parse(content) as { domains?: DomainClassification[] };
      const domains = Array.isArray(parsed.domains) ? parsed.domains : [];

      logger.info('Domain classification complete', {
        component: 'DomainClassifier',
        retireeId: emailAnalysis.retireeId,
        domainCount: String(domains.length),
      });

      return domains;
    } catch (error: unknown) {
      logger.error('Failed to parse domain classification response', {
        component: 'DomainClassifier',
        operation: 'classifyDomains',
        error: error instanceof Error ? error : undefined,
      });
      return [];
    }
  }

  private buildPrompt(
    emailAnalysis: EmailAnalysis,
    calendarData: object,
    documentData: object,
  ): string {
    const topContacts = Object.entries(emailAnalysis.contactFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([email, count]) => `${email}: ${count} interactions`);

    const topTopics = Object.entries(emailAnalysis.topicDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([topic, count]) => `${topic}: ${count} occurrences`);

    return `## Email Patterns (last ${emailAnalysis.period.start.toISOString()} to ${emailAnalysis.period.end.toISOString()})

### Top contacts:
${topContacts.join('\n')}

### Top email topics:
${topTopics.join('\n')}

### Unique contacts (only this person communicates with):
${emailAnalysis.uniqueContacts.slice(0, 10).join(', ')}

### Thread patterns:
- Long-running threads: ${emailAnalysis.threadPatterns.longRunning.slice(0, 5).join(', ')}
- Recurring patterns: ${emailAnalysis.threadPatterns.recurring.slice(0, 5).join(', ')}

## Calendar Data:
${JSON.stringify(calendarData, null, 2)}

## Document Activity:
${JSON.stringify(documentData, null, 2)}

Identify the distinct knowledge domains this person holds based on the above data.`;
  }
}
