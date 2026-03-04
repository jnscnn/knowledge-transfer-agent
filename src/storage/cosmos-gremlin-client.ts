import Gremlin from 'gremlin';
import { logger } from '../shared/logger.js';
import { AzureServiceError } from '../shared/errors.js';

export interface VertexResult {
  id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface EdgeResult {
  id: string;
  label: string;
  inV: string;
  outV: string;
  properties: Record<string, unknown>;
}

export class CosmosGremlinClient {
  private client: Gremlin.driver.Client;

  constructor(endpoint: string, primaryKey: string, database: string, collection: string = 'knowledge-graph') {
    const authenticator = new Gremlin.driver.auth.PlainTextSaslAuthenticator(
      `/dbs/${database}/colls/${collection}`,
      primaryKey,
    );

    this.client = new Gremlin.driver.Client(endpoint, {
      authenticator,
      traversalsource: 'g',
      mimeType: 'application/vnd.gremlin-v2.0+json',
      rejectUnauthorized: true,
    });
  }

  async open(): Promise<void> {
    await this.client.open();
    logger.info('Gremlin client connected', { component: 'CosmosGremlinClient' });
  }

  async addVertex(
    label: string,
    id: string,
    properties: Record<string, string | number | boolean>,
  ): Promise<VertexResult> {
    try {
      let query = `g.addV('${label}').property('id', id).property('pk', pk)`;
      const bindings: Record<string, unknown> = { id, pk: id };

      let paramIndex = 0;
      for (const [key, value] of Object.entries(properties)) {
        const paramName = `p${paramIndex++}`;
        query += `.property('${key}', ${paramName})`;
        bindings[paramName] = value;
      }

      const result = await this.client.submit(query, bindings);
      const items = result.toArray();
      return this.toVertex(items[0]);
    } catch (error) {
      throw new AzureServiceError(
        'CosmosGremlin',
        'addVertex',
        error instanceof Error ? error.message : String(error),
        { label, id },
      );
    }
  }

  async addEdge(
    label: string,
    fromId: string,
    toId: string,
    properties: Record<string, string | number | boolean> = {},
  ): Promise<EdgeResult> {
    try {
      let query = `g.V(fromId).addE('${label}').to(g.V(toId))`;
      const bindings: Record<string, unknown> = { fromId, toId };

      let paramIndex = 0;
      for (const [key, value] of Object.entries(properties)) {
        const paramName = `ep${paramIndex++}`;
        query += `.property('${key}', ${paramName})`;
        bindings[paramName] = value;
      }

      const result = await this.client.submit(query, bindings);
      const items = result.toArray();
      return this.toEdge(items[0]);
    } catch (error) {
      throw new AzureServiceError(
        'CosmosGremlin',
        'addEdge',
        error instanceof Error ? error.message : String(error),
        { label, fromId, toId },
      );
    }
  }

  async getVertex(id: string): Promise<VertexResult | undefined> {
    try {
      const result = await this.client.submit('g.V(id)', { id });
      const items = result.toArray();
      return items.length > 0 ? this.toVertex(items[0]) : undefined;
    } catch (error) {
      throw new AzureServiceError(
        'CosmosGremlin',
        'getVertex',
        error instanceof Error ? error.message : String(error),
        { id },
      );
    }
  }

  async getNeighbors(
    id: string,
    edgeLabel?: string,
    direction: 'out' | 'in' | 'both' = 'both',
  ): Promise<VertexResult[]> {
    try {
      let query: string;
      if (edgeLabel) {
        query = `g.V(id).${direction}('${edgeLabel}')`;
      } else {
        query = `g.V(id).${direction}()`;
      }

      // For 'out' and 'in' edges, we traverse to adjacent vertices
      if (direction === 'out') {
        query = edgeLabel
          ? `g.V(id).out('${edgeLabel}')`
          : `g.V(id).out()`;
      } else if (direction === 'in') {
        query = edgeLabel
          ? `g.V(id).in('${edgeLabel}')`
          : `g.V(id).in()`;
      } else {
        query = edgeLabel
          ? `g.V(id).both('${edgeLabel}')`
          : `g.V(id).both()`;
      }

      const result = await this.client.submit(query, { id });
      return result.toArray().map((item) => this.toVertex(item));
    } catch (error) {
      throw new AzureServiceError(
        'CosmosGremlin',
        'getNeighbors',
        error instanceof Error ? error.message : String(error),
        { id, edgeLabel, direction },
      );
    }
  }

  async query(gremlinQuery: string, bindings?: Record<string, unknown>): Promise<unknown[]> {
    try {
      const result = await this.client.submit(gremlinQuery, bindings);
      return result.toArray();
    } catch (error) {
      throw new AzureServiceError(
        'CosmosGremlin',
        'query',
        error instanceof Error ? error.message : String(error),
        { gremlinQuery },
      );
    }
  }

  async close(): Promise<void> {
    await this.client.close();
    logger.info('Gremlin client closed', { component: 'CosmosGremlinClient' });
  }

  // ── Helpers ──

  private toVertex(raw: unknown): VertexResult {
    const v = raw as Record<string, unknown>;
    return {
      id: String(v['id'] ?? ''),
      label: String(v['label'] ?? ''),
      properties: (v['properties'] as Record<string, unknown>) ?? {},
    };
  }

  private toEdge(raw: unknown): EdgeResult {
    const e = raw as Record<string, unknown>;
    return {
      id: String(e['id'] ?? ''),
      label: String(e['label'] ?? ''),
      inV: String(e['inV'] ?? ''),
      outV: String(e['outV'] ?? ''),
      properties: (e['properties'] as Record<string, unknown>) ?? {},
    };
  }
}
