// Entity extraction using GPT-4o

import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { logger } from '../shared/logger.js';
import { AzureServiceError, PipelineError } from '../shared/errors.js';
import { withRetry } from '../shared/retry.js';
import type { EntityMention, EntityType, RelationshipType } from '../shared/types.js';
import { v4 as uuidv4 } from 'uuid';

const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

const ENTITY_EXTRACTION_PROMPT = `You are an expert knowledge extraction system. Analyze the following text and extract all entities and their relationships.

Entity types to extract:
- Person: Named individuals, roles, or contacts
- Organization: Companies, departments, teams, groups
- System: Software systems, tools, platforms, applications
- Process: Business processes, workflows, procedures
- Decision: Key decisions, policies, rules
- Workaround: Known workarounds, hacks, unofficial solutions
- Document: Referenced documents, manuals, guides, wikis
- Vendor: External vendors, partners, service providers

Relationship types to extract:
- owns: A person/team owns a system/process/document
- uses: An entity uses another entity
- contacts: A person contacts another person/org for something
- decided: A person/org made a decision
- depends_on: An entity depends on another
- has_workaround: An issue/system has a workaround
- escalates_to: An issue/person escalates to another person/org

Return your response as valid JSON matching this exact schema:
{
  "entities": [
    {
      "text": "entity name as mentioned in text",
      "type": "Person|Organization|System|Process|Decision|Workaround|Document|Vendor",
      "confidence": 0.0-1.0
    }
  ],
  "relationships": [
    {
      "sourceEntity": "source entity name",
      "targetEntity": "target entity name",
      "type": "owns|uses|contacts|decided|depends_on|has_workaround|escalates_to",
      "context": "brief description of the relationship",
      "confidence": 0.0-1.0
    }
  ]
}

Text to analyze:
`;

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set<EntityType>([
  'Person', 'Organization', 'System', 'Process',
  'Decision', 'Workaround', 'Document', 'Vendor',
]);

const VALID_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set<RelationshipType>([
  'owns', 'uses', 'contacts', 'decided',
  'depends_on', 'has_workaround', 'escalates_to',
  'documents', 'belongs_to', 'succeeded_by', 'rationale_for',
]);

interface RawEntity {
  text?: string;
  type?: string;
  confidence?: number;
}

interface RawRelationship {
  sourceEntity?: string;
  targetEntity?: string;
  type?: string;
  context?: string;
  confidence?: number;
}

interface ExtractionResult {
  entities: EntityMention[];
  relationships: Array<{
    sourceEntity: string;
    targetEntity: string;
    type: RelationshipType;
    context: string;
    confidence: number;
  }>;
}

export class EntityExtractor {
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

  async extractEntities(text: string): Promise<EntityMention[]> {
    const result = await this.extractEntitiesAndRelationships(text);
    return result.entities;
  }

  async extractEntitiesAndRelationships(text: string): Promise<ExtractionResult> {
    logger.debug('Extracting entities and relationships', {
      component: 'EntityExtractor',
      textLength: String(text.length),
    });

    const rawResponse = await withRetry(
      async () => {
        const response = await this.client.chat.completions.create({
          model: this.deploymentName,
          messages: [
            {
              role: 'system',
              content: 'You are a precise entity extraction system. Always respond with valid JSON only, no markdown fences.',
            },
            {
              role: 'user',
              content: ENTITY_EXTRACTION_PROMPT + text,
            },
          ],
          max_tokens: 2000,
          temperature: 0.1,
          response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new AzureServiceError(
            'AzureOpenAI',
            'extractEntities',
            'No content in GPT-4o response',
          );
        }
        return content;
      },
      { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 30_000, jitter: true },
    );

    return this.parseExtractionResponse(rawResponse);
  }

  private parseExtractionResponse(response: string): ExtractionResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(response);
    } catch {
      throw new PipelineError('Failed to parse entity extraction response as JSON', {
        response: response.slice(0, 500),
      });
    }

    const data = parsed as { entities?: RawEntity[]; relationships?: RawRelationship[] };

    const entities: EntityMention[] = [];
    if (Array.isArray(data.entities)) {
      for (const raw of data.entities) {
        if (raw.text && raw.type && VALID_ENTITY_TYPES.has(raw.type)) {
          entities.push({
            entityId: uuidv4(),
            text: raw.text,
            type: raw.type as EntityType,
            confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
          });
        }
      }
    }

    const relationships: ExtractionResult['relationships'] = [];
    if (Array.isArray(data.relationships)) {
      for (const raw of data.relationships) {
        if (
          raw.sourceEntity &&
          raw.targetEntity &&
          raw.type &&
          VALID_RELATIONSHIP_TYPES.has(raw.type)
        ) {
          relationships.push({
            sourceEntity: raw.sourceEntity,
            targetEntity: raw.targetEntity,
            type: raw.type as RelationshipType,
            context: raw.context ?? '',
            confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
          });
        }
      }
    }

    logger.debug('Entity extraction parsed', {
      component: 'EntityExtractor',
      entityCount: String(entities.length),
      relationshipCount: String(relationships.length),
    });

    return { entities, relationships };
  }
}
