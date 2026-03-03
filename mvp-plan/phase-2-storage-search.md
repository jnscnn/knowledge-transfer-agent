# Phase 2: Storage, Search & Observer Pipeline

## Objective

Build the knowledge processing pipeline, set up the storage layer, and implement the passive observer that monitors the retiree's work patterns via Microsoft Graph API.

## Processing Pipeline

### Azure Functions Setup

```
functions/
├── host.json
├── package.json
├── tsconfig.json
├── src/
│   ├── functions/
│   │   ├── process-interview.ts      # Blob trigger: new interview transcript
│   │   ├── process-observation.ts    # Event Grid trigger: Graph change notification
│   │   ├── reprocess-chunk.ts        # HTTP trigger: manual re-processing
│   │   ├── consistency-check.ts      # Timer trigger: cross-store verification
│   │   └── graph-webhook.ts          # HTTP trigger: Graph API webhook receiver
│   ├── pipeline/
│   │   ├── chunk.ts                  # Semantic chunking logic
│   │   ├── embed.ts                  # Azure OpenAI embedding generation
│   │   ├── extract-entities.ts       # Entity extraction (NER + GPT-4o)
│   │   ├── extract-relationships.ts  # Relationship extraction between entities
│   │   ├── score-quality.ts          # Quality scoring for chunks
│   │   └── classify-sensitivity.ts   # Sensitivity classification
│   ├── storage/
│   │   ├── ai-search-writer.ts       # Write chunks to Azure AI Search
│   │   ├── cosmos-writer.ts          # Write entities/metadata to Cosmos DB
│   │   ├── graph-writer.ts           # Write to Gremlin API (knowledge graph)
│   │   └── blob-writer.ts            # Write raw data to Blob Storage
│   └── shared/
│       ├── types.ts
│       ├── config.ts
│       └── retry.ts                  # Exponential backoff with jitter
```

### Chunking Implementation

```typescript
interface ChunkingConfig {
  strategy: 'topic_boundary' | 'heading_based' | 'speaker_turn' | 'message_thread';
  targetTokens: { min: number; max: number };
  overlapTokens: number;
  preserveContext: boolean;
}

const CHUNKING_STRATEGIES: Record<string, ChunkingConfig> = {
  interview_transcript: {
    strategy: 'topic_boundary',
    targetTokens: { min: 500, max: 1000 },
    overlapTokens: 50,
    preserveContext: true,
  },
  email_thread: {
    strategy: 'message_thread',
    targetTokens: { min: 300, max: 500 },
    overlapTokens: 30,
    preserveContext: true,
  },
  document: {
    strategy: 'heading_based',
    targetTokens: { min: 500, max: 1000 },
    overlapTokens: 50,
    preserveContext: true,
  },
  teams_messages: {
    strategy: 'message_thread',
    targetTokens: { min: 200, max: 500 },
    overlapTokens: 20,
    preserveContext: true,
  },
};
```

### Entity Extraction Prompt

```markdown
Extract named entities from the following knowledge chunk. Return structured JSON.

## Entity Types
- **Person**: Named individuals (include role/department if mentioned)
- **Organization**: Companies, departments, teams
- **System**: Software, tools, platforms, databases
- **Process**: Business processes, workflows, procedures
- **Decision**: Past decisions with rationale
- **Workaround**: Non-standard procedures or hacks
- **Document**: Named documents, templates, runbooks
- **Vendor**: External vendors or partners

## Output Format
{
  "entities": [
    {
      "text": "exact text from the chunk",
      "type": "Person|Organization|System|...",
      "normalized_name": "canonical name",
      "properties": { "role": "...", "department": "..." },
      "confidence": 0.95
    }
  ],
  "relationships": [
    {
      "source": "normalized_name_1",
      "target": "normalized_name_2",
      "type": "owns|uses|contacts|decided|depends_on|has_workaround|escalates_to",
      "context": "brief description of relationship",
      "confidence": 0.90
    }
  ]
}
```

## Azure AI Search Index Setup

### Index Creation Script

```typescript
import { SearchIndexClient, SearchIndex } from '@azure/search-documents';

const index: SearchIndex = {
  name: 'knowledge-chunks',
  fields: [
    { name: 'id', type: 'Edm.String', key: true, filterable: true },
    { name: 'content', type: 'Edm.String', searchable: true, analyzerName: 'en.microsoft' },
    { name: 'summary', type: 'Edm.String', searchable: true, analyzerName: 'en.microsoft' },
    {
      name: 'content_vector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      vectorSearchDimensions: 3072,
      vectorSearchProfileName: 'hnsw-profile',
    },
    {
      name: 'hyde_vector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      vectorSearchDimensions: 3072,
      vectorSearchProfileName: 'hnsw-profile',
    },
    { name: 'source_type', type: 'Edm.String', filterable: true, facetable: true },
    { name: 'retiree_id', type: 'Edm.String', filterable: true },
    { name: 'knowledge_domain', type: 'Edm.String', filterable: true, facetable: true },
    { name: 'knowledge_type', type: 'Edm.String', filterable: true, facetable: true },
    { name: 'sensitivity_level', type: 'Edm.String', filterable: true },
    { name: 'quality_score', type: 'Edm.Double', filterable: true, sortable: true },
    { name: 'entities', type: 'Collection(Edm.String)', filterable: true, facetable: true },
    { name: 'timestamp', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
    { name: 'consent_id', type: 'Edm.String', filterable: true },
  ],
  vectorSearch: {
    algorithms: [{ name: 'hnsw', kind: 'hnsw', parameters: { m: 4, efConstruction: 400, efSearch: 500, metric: 'cosine' } }],
    profiles: [{ name: 'hnsw-profile', algorithmConfigurationName: 'hnsw' }],
  },
  semantic: {
    configurations: [{
      name: 'default',
      prioritizedFields: {
        titleField: { fieldName: 'summary' },
        contentFields: [{ fieldName: 'content' }],
      },
    }],
  },
};
```

## Passive Observer Implementation

### Graph API Subscriptions

```typescript
interface GraphSubscription {
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState: string;
}

const subscriptions: GraphSubscription[] = [
  {
    resource: '/users/{retiree-id}/messages',
    changeType: 'created',
    notificationUrl: 'https://{function-app}.azurewebsites.net/api/graph-webhook',
    expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days
    clientState: 'kt-agent-email-observer',
  },
  {
    resource: '/users/{retiree-id}/events',
    changeType: 'created,updated',
    notificationUrl: 'https://{function-app}.azurewebsites.net/api/graph-webhook',
    expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    clientState: 'kt-agent-calendar-observer',
  },
  {
    resource: `/users/{retiree-id}/drive/root`,
    changeType: 'updated',
    notificationUrl: 'https://{function-app}.azurewebsites.net/api/graph-webhook',
    expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    clientState: 'kt-agent-drive-observer',
  },
];
```

### Email Pattern Analyzer

```typescript
interface EmailAnalysis {
  retireeId: string;
  period: { start: Date; end: Date };
  contactFrequency: Map<string, number>;    // contact email → count
  topicDistribution: Map<string, number>;    // topic → count
  uniqueContacts: string[];                  // contacts only retiree interacts with
  threadPatterns: {
    longRunning: string[];                   // thread IDs with 10+ messages
    recurring: string[];                     // threads that repeat on a schedule
  };
  knowledgeDomains: {
    domain: string;
    confidence: number;
    evidenceCount: number;
  }[];
}
```

### Knowledge Domain Classifier

Uses GPT-4o to classify observed activity into knowledge domains:

```typescript
interface DomainClassification {
  domain: string;
  parentDomain?: string;
  confidence: number;
  evidence: {
    emails: number;
    meetings: number;
    documents: number;
    teamsMessages: number;
  };
  suggestedInterviewQuestions: string[];
  gapIndicators: string[];  // Signs this domain needs deeper exploration
}
```

## Cosmos DB Schema Setup

> ⚠️ **Important:** Cosmos DB accounts are API-specific. The NoSQL and Gremlin APIs **cannot** share a single account.
> This requires two separate Cosmos DB accounts.

### NoSQL API Account (`kt-cosmos-nosql-{suffix}`)

```typescript
// Database: kt-agent
// Container: retirees (partition key: /id)
// Container: knowledge-chunks (partition key: /retireeId)
// Container: interview-sessions (partition key: /retireeId)
// Container: observations (partition key: /retireeId)
// Container: queries (partition key: /userId)

import { CosmosClient } from '@azure/cosmos';

async function initializeNoSqlDatabase(client: CosmosClient): Promise<void> {
  const { database } = await client.databases.createIfNotExists({ id: 'kt-agent' });

  const containers = [
    { id: 'retirees', partitionKey: '/id' },
    { id: 'knowledge-chunks', partitionKey: '/retireeId' },
    { id: 'interview-sessions', partitionKey: '/retireeId' },
    { id: 'observations', partitionKey: '/retireeId' },
    { id: 'queries', partitionKey: '/userId' },
    { id: 'consent', partitionKey: '/retireeId' },
  ];

  for (const container of containers) {
    await database.containers.createIfNotExists({
      id: container.id,
      partitionKey: { paths: [container.partitionKey] },
    });
  }
}
```

### Gremlin API Account (`kt-cosmos-graph-{suffix}`)

```typescript
// Connecting to Cosmos DB Gremlin requires the `gremlin` NPM package
// with WebSocket + SASL authentication

import Gremlin from "gremlin";

function createGremlinClient(): Gremlin.driver.Client {
  const authenticator = new Gremlin.driver.auth.PlainTextSaslAuthenticator(
    `/dbs/kt-graph/colls/knowledge-graph`,
    process.env.COSMOS_GREMLIN_KEY!
  );
  
  return new Gremlin.driver.Client(
    process.env.COSMOS_GREMLIN_ENDPOINT!, // wss://kt-cosmos-graph-{suffix}.gremlin.cosmos.azure.com:443/
    {
      authenticator,
      traversalsource: "g",
      mimeType: "application/vnd.gremlin-v2.0+json",
      rejectUnauthorized: true,
    }
  );
}
```

## Test Criteria for Phase 2

- [ ] Azure Functions deploy and run successfully
- [ ] Graph API webhook receives and processes change notifications
- [ ] Email analyzer produces contact frequency and topic distribution
- [ ] Calendar analyzer identifies recurring meetings and patterns
- [ ] Knowledge domain classifier generates domain suggestions with evidence
- [ ] Chunking produces correctly sized chunks with metadata
- [ ] Embedding pipeline generates 3072-dimension vectors
- [ ] Entity extraction identifies people, systems, processes from text
- [ ] Relationship extraction connects entities with typed edges
- [ ] Quality scoring produces reasonable scores for test chunks
- [ ] AI Search index accepts and returns vector search results
- [ ] Cosmos DB Gremlin API accepts entity vertices and relationship edges
- [ ] Consistency checker identifies and flags cross-store gaps
- [ ] Pipeline handles errors gracefully with retry + dead-letter
