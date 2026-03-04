// Cross-chunk relationship discovery via Gremlin graph

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../shared/logger.js';
import { PipelineError } from '../shared/errors.js';
import { withRetry } from '../shared/retry.js';
import type { EntityMention, Entity, RelationshipType } from '../shared/types.js';
import type { CosmosGremlinClient, VertexResult } from '../storage/cosmos-gremlin-client.js';

export class RelationshipExtractor {
  private gremlinClient: CosmosGremlinClient;

  constructor(gremlinClient: CosmosGremlinClient) {
    this.gremlinClient = gremlinClient;
  }

  async mergeEntity(entity: EntityMention, retireeId: string): Promise<Entity> {
    logger.debug('Merging entity', {
      component: 'RelationshipExtractor',
      entityText: entity.text,
      entityType: entity.type,
    });

    // Try to find an existing entity by name or alias
    const existing = await this.findEntity(entity.text, retireeId);
    if (existing) {
      // Update mention count and lastSeen
      await withRetry(async () => {
        await this.gremlinClient.query(
          `g.V(id).property('mentionCount', mentionCount).property('lastSeen', lastSeen)`,
          {
            id: existing.id,
            mentionCount: existing.mentionCount + 1,
            lastSeen: new Date().toISOString(),
          },
        );
      });

      return {
        ...existing,
        mentionCount: existing.mentionCount + 1,
        lastSeen: new Date(),
      };
    }

    // Create new entity vertex
    const entityId = entity.entityId || uuidv4();
    const now = new Date();

    await withRetry(async () => {
      await this.gremlinClient.addVertex('entity', entityId, {
        name: entity.text,
        type: entity.type,
        retireeId,
        mentionCount: 1,
        aliases: JSON.stringify([entity.text]),
        domains: JSON.stringify([]),
        description: '',
        firstSeen: now.toISOString(),
        lastSeen: now.toISOString(),
        confidence: entity.confidence,
      });
    });

    return {
      id: entityId,
      type: entity.type,
      name: entity.text,
      aliases: [entity.text],
      description: '',
      properties: { confidence: entity.confidence },
      mentionCount: 1,
      domains: [],
      firstSeen: now,
      lastSeen: now,
    };
  }

  async addRelationships(
    relationships: Array<{
      sourceEntity: string;
      targetEntity: string;
      type: RelationshipType;
      context: string;
      confidence: number;
      chunkId: string;
    }>,
    retireeId: string,
  ): Promise<void> {
    logger.debug('Adding relationships', {
      component: 'RelationshipExtractor',
      count: String(relationships.length),
    });

    for (const rel of relationships) {
      try {
        // Find source and target entities
        const source = await this.findEntity(rel.sourceEntity, retireeId);
        const target = await this.findEntity(rel.targetEntity, retireeId);

        if (!source || !target) {
          logger.warn('Skipping relationship: entity not found', {
            component: 'RelationshipExtractor',
            sourceEntity: rel.sourceEntity,
            targetEntity: rel.targetEntity,
            sourceFound: String(!!source),
            targetFound: String(!!target),
          });
          continue;
        }

        await withRetry(async () => {
          await this.gremlinClient.addEdge(rel.type, source.id, target.id, {
            context: rel.context,
            confidence: rel.confidence,
            chunkId: rel.chunkId,
            retireeId,
            createdAt: new Date().toISOString(),
          });
        });

        logger.debug('Relationship added', {
          component: 'RelationshipExtractor',
          type: rel.type,
          source: source.name,
          target: target.name,
        });
      } catch (error) {
        logger.error('Failed to add relationship', {
          component: 'RelationshipExtractor',
          error: error instanceof Error ? error : undefined,
          sourceEntity: rel.sourceEntity,
          targetEntity: rel.targetEntity,
          type: rel.type,
        });
      }
    }
  }

  async findEntity(name: string, retireeId: string): Promise<Entity | null> {
    try {
      // Search by name property
      const results = await this.gremlinClient.query(
        `g.V().has('retireeId', retireeId).has('name', name)`,
        { retireeId, name },
      ) as VertexResult[];

      if (results.length > 0) {
        return this.vertexToEntity(results[0]);
      }

      // Search by aliases (stored as JSON array string)
      const aliasResults = await this.gremlinClient.query(
        `g.V().has('retireeId', retireeId).has('label', 'entity')`,
        { retireeId },
      ) as VertexResult[];

      const normalizedName = name.toLowerCase().trim();
      for (const vertex of aliasResults) {
        const aliasesRaw = this.getVertexProperty(vertex, 'aliases');
        if (typeof aliasesRaw === 'string') {
          try {
            const aliases = JSON.parse(aliasesRaw) as string[];
            if (aliases.some((a) => a.toLowerCase().trim() === normalizedName)) {
              return this.vertexToEntity(vertex);
            }
          } catch {
            // Invalid JSON in aliases, skip
          }
        }
      }

      return null;
    } catch (error) {
      throw new PipelineError(
        `Failed to find entity: ${error instanceof Error ? error.message : String(error)}`,
        { name, retireeId },
      );
    }
  }

  private vertexToEntity(vertex: VertexResult): Entity {
    const props = vertex.properties;

    let aliases: string[] = [];
    const aliasesRaw = this.getVertexProperty(vertex, 'aliases');
    if (typeof aliasesRaw === 'string') {
      try {
        aliases = JSON.parse(aliasesRaw) as string[];
      } catch {
        aliases = [];
      }
    }

    let domains: string[] = [];
    const domainsRaw = this.getVertexProperty(vertex, 'domains');
    if (typeof domainsRaw === 'string') {
      try {
        domains = JSON.parse(domainsRaw) as string[];
      } catch {
        domains = [];
      }
    }

    return {
      id: vertex.id,
      type: (this.getVertexProperty(vertex, 'type') as string ?? 'System') as Entity['type'],
      name: (this.getVertexProperty(vertex, 'name') as string) ?? '',
      aliases,
      description: (this.getVertexProperty(vertex, 'description') as string) ?? '',
      properties: props,
      mentionCount: Number(this.getVertexProperty(vertex, 'mentionCount') ?? 0),
      domains,
      firstSeen: new Date(String(this.getVertexProperty(vertex, 'firstSeen') ?? new Date().toISOString())),
      lastSeen: new Date(String(this.getVertexProperty(vertex, 'lastSeen') ?? new Date().toISOString())),
    };
  }

  private getVertexProperty(vertex: VertexResult, key: string): unknown {
    const prop = vertex.properties[key];
    // Cosmos Gremlin may return properties as [{ value: ... }]
    if (Array.isArray(prop) && prop.length > 0) {
      return (prop[0] as { value?: unknown }).value ?? prop[0];
    }
    return prop;
  }
}
