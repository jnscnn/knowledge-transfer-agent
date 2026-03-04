import { CosmosClient, Container, Database, SqlQuerySpec } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { logger } from '../shared/logger.js';
import { EntityNotFoundError, AzureServiceError } from '../shared/errors.js';

const CONTAINER_DEFS = [
  { id: 'retirees', partitionKey: '/id' },
  { id: 'knowledgeChunks', partitionKey: '/retireeId' },
  { id: 'interviewSessions', partitionKey: '/retireeId' },
  { id: 'observations', partitionKey: '/retireeId' },
  { id: 'queries', partitionKey: '/id' },
  { id: 'consent', partitionKey: '/retireeId' },
] as const;

type ContainerName = (typeof CONTAINER_DEFS)[number]['id'];

export class CosmosNoSqlClient {
  private client: CosmosClient;
  private databaseId: string;
  private database: Database | undefined;
  private containers = new Map<string, Container>();

  constructor(endpoint: string, key?: string, databaseId: string = 'kt-agent') {
    this.databaseId = databaseId;
    this.client = key
      ? new CosmosClient({ endpoint, key })
      : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  }

  async initializeDatabase(): Promise<void> {
    logger.info('Initializing Cosmos DB NoSQL database', {
      component: 'CosmosNoSqlClient',
      operation: 'initializeDatabase',
    });

    const { database } = await this.client.databases.createIfNotExists({
      id: this.databaseId,
    });
    this.database = database;

    for (const def of CONTAINER_DEFS) {
      const { container } = await database.containers.createIfNotExists({
        id: def.id,
        partitionKey: { paths: [def.partitionKey] },
      });
      this.containers.set(def.id, container);
      logger.info(`Container ready: ${def.id}`, {
        component: 'CosmosNoSqlClient',
      });
    }

    logger.info('Cosmos DB NoSQL initialization complete', {
      component: 'CosmosNoSqlClient',
    });
  }

  private getContainer(name: ContainerName): Container {
    const cached = this.containers.get(name);
    if (cached) return cached;

    if (!this.database) {
      this.database = this.client.database(this.databaseId);
    }
    const container = this.database.container(name);
    this.containers.set(name, container);
    return container;
  }

  // ── Container accessors ──

  get retirees(): Container {
    return this.getContainer('retirees');
  }

  get knowledgeChunks(): Container {
    return this.getContainer('knowledgeChunks');
  }

  get interviewSessions(): Container {
    return this.getContainer('interviewSessions');
  }

  get observations(): Container {
    return this.getContainer('observations');
  }

  get queries(): Container {
    return this.getContainer('queries');
  }

  get consent(): Container {
    return this.getContainer('consent');
  }

  // ── Generic CRUD ──

  async create<T extends Record<string, unknown>>(
    containerName: ContainerName,
    item: T,
    partitionKey: string,
  ): Promise<T> {
    try {
      const { resource } = await this.getContainer(containerName).items.create(item);
      return resource as T;
    } catch (error) {
      throw new AzureServiceError(
        'CosmosDB',
        'create',
        error instanceof Error ? error.message : String(error),
        { containerName, partitionKey },
      );
    }
  }

  async read<T>(
    containerName: ContainerName,
    id: string,
    partitionKey: string,
  ): Promise<T> {
    try {
      const { resource } = await this.getContainer(containerName)
        .item(id, partitionKey)
        .read();
      if (!resource) {
        throw new EntityNotFoundError(containerName, id);
      }
      return resource as unknown as T;
    } catch (error) {
      if (error instanceof EntityNotFoundError) throw error;
      const statusCode = (error as { code?: number }).code;
      if (statusCode === 404) {
        throw new EntityNotFoundError(containerName, id);
      }
      throw new AzureServiceError(
        'CosmosDB',
        'read',
        error instanceof Error ? error.message : String(error),
        { containerName, id, partitionKey },
      );
    }
  }

  async query<T>(
    containerName: ContainerName,
    querySpec: SqlQuerySpec,
  ): Promise<T[]> {
    try {
      const { resources } = await this.getContainer(containerName)
        .items.query<T>(querySpec)
        .fetchAll();
      return resources;
    } catch (error) {
      throw new AzureServiceError(
        'CosmosDB',
        'query',
        error instanceof Error ? error.message : String(error),
        { containerName, query: querySpec.query },
      );
    }
  }

  async upsert<T extends Record<string, unknown>>(
    containerName: ContainerName,
    item: T,
    partitionKey: string,
  ): Promise<T> {
    try {
      const { resource } = await this.getContainer(containerName).items.upsert(item);
      return resource as unknown as T;
    } catch (error) {
      throw new AzureServiceError(
        'CosmosDB',
        'upsert',
        error instanceof Error ? error.message : String(error),
        { containerName, partitionKey },
      );
    }
  }

  async delete(
    containerName: ContainerName,
    id: string,
    partitionKey: string,
  ): Promise<void> {
    try {
      await this.getContainer(containerName).item(id, partitionKey).delete();
    } catch (error) {
      throw new AzureServiceError(
        'CosmosDB',
        'delete',
        error instanceof Error ? error.message : String(error),
        { containerName, id, partitionKey },
      );
    }
  }
}

// ── CLI init support ──
if (process.argv.includes('--init')) {
  const endpoint = process.env['COSMOS_NOSQL_ENDPOINT'];
  const key = process.env['COSMOS_NOSQL_KEY'];
  const database = process.env['COSMOS_NOSQL_DATABASE'] ?? 'kt-agent';

  if (!endpoint) {
    console.error('COSMOS_NOSQL_ENDPOINT is required');
    process.exit(1);
  }

  const client = new CosmosNoSqlClient(endpoint, key, database);
  client
    .initializeDatabase()
    .then(() => {
      console.log('Cosmos DB NoSQL initialization complete');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('Initialization failed:', error);
      process.exit(1);
    });
}
