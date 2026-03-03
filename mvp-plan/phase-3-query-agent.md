# Phase 3: Query Agent & Teams Integration

## Objective

Build the query agent that answers colleagues' questions using RAG over the knowledge stores, and complete the Teams bot integration for both interview and query experiences.

## Query Agent Architecture

### RAG Pipeline

```typescript
interface QueryPipeline {
  // Step 1: Parse and understand the question
  parseIntent(question: string): Promise<QueryIntent>;
  
  // Step 2: Rewrite for better retrieval
  rewriteQuery(intent: QueryIntent): Promise<RewrittenQuery>;
  
  // Step 3: Retrieve from multiple sources in parallel
  retrieve(query: RewrittenQuery): Promise<RetrievalResults>;
  
  // Step 4: Rerank and fuse results
  rerank(results: RetrievalResults): Promise<RankedResults>;
  
  // Step 5: Generate answer with citations
  generate(question: string, context: RankedResults): Promise<AgentResponse>;
  
  // Step 6: Apply guardrails
  applyGuardrails(response: AgentResponse, user: UserContext): Promise<AgentResponse>;
}

interface QueryIntent {
  type: 'factual' | 'relational' | 'procedural' | 'decision_context' | 'exploratory' | 'meta';
  entities: string[];
  domains: string[];
  timeScope?: { start: Date; end: Date };
  retireeScope?: string[];
}

interface RewrittenQuery {
  vectorQuery: string;       // Optimized for embedding similarity
  keywordQuery: string;      // Optimized for BM25 matching
  graphQuery?: string;       // Gremlin query for relationship traversal
  filters: SearchFilters;    // Metadata filters (domain, sensitivity, retiree)
}

interface AgentResponse {
  answer: string;
  confidence: number;
  sources: Citation[];
  coverage: 'complete' | 'partial' | 'insufficient';
  followUps: string[];
  processingTime: number;
}

interface Citation {
  type: 'interview' | 'email' | 'document' | 'observation';
  sourceId: string;
  title: string;
  url?: string;
  relevance: number;
  timestamp: Date;
  retiree: string;
}
```

### Multi-Source Retrieval

```typescript
async function retrieve(query: RewrittenQuery): Promise<RetrievalResults> {
  // Execute all retrievals in parallel
  const [vectorResults, graphResults, documentResults] = await Promise.all([
    searchVectorStore(query),
    queryKnowledgeGraph(query),
    searchDocuments(query),
  ]);

  return { vectorResults, graphResults, documentResults };
}

async function searchVectorStore(query: RewrittenQuery): Promise<VectorResult[]> {
  const searchClient = new SearchClient(endpoint, 'knowledge-chunks', credential);

  const results = await searchClient.search(query.keywordQuery, {
    vectorSearchOptions: {
      queries: [
        { kind: 'vector', vector: await embed(query.vectorQuery), kNearestNeighborsCount: 10, fields: ['content_vector'] },
        { kind: 'vector', vector: await embed(query.vectorQuery), kNearestNeighborsCount: 5, fields: ['hyde_vector'] },
      ],
    },
    filter: buildODataFilter(query.filters),
    queryType: 'semantic',
    semanticSearchOptions: { configurationName: 'default' },
    top: 15,
  });

  return parseResults(results);
}

async function queryKnowledgeGraph(query: RewrittenQuery): Promise<GraphResult[]> {
  if (!query.graphQuery) return [];
  
  const client = new GremlinClient(cosmosEndpoint, cosmosKey, 'kt-agent', 'knowledge-graph');
  const results = await client.submit(query.graphQuery);
  
  return results.map(r => ({
    entity: r,
    relationships: r.edges,
    relevance: calculateGraphRelevance(r, query),
  }));
}
```

### Answer Generation System Prompt

```markdown
You are a Knowledge Transfer Query Agent. You answer questions about institutional 
knowledge captured from retiring employees.

## Rules
1. ONLY answer based on the provided context. Never make up information.
2. If the context doesn't contain enough information, say so clearly.
3. Always cite your sources using [Source N] notation.
4. Include a confidence indicator (High/Medium/Low) based on:
   - High: Multiple corroborating sources, specific and recent
   - Medium: Single good source or multiple weaker sources
   - Low: Tangentially related sources, may be incomplete
5. Suggest follow-up questions when the answer might be partial.
6. If the question involves sensitive information, note the sensitivity level.

## Answer Format
Provide a clear, structured answer. Use:
- Bullet points for lists and steps
- Bold for key names, systems, and processes
- ⚠️ for warnings, gotchas, or known issues
- 📎 for document references
- 💡 for suggested follow-ups

## Citation Format
[Source 1]: Interview with [Retiree Name], [Date] — [Topic]
[Source 2]: Email thread, [Date] — [Subject]
[Source 3]: Document: [Title], [Location]
```

### Confidence Scoring

```typescript
interface ConfidenceFactors {
  sourceCount: number;          // Number of relevant sources found
  topRelevance: number;         // Relevance score of best source
  sourceDiversity: number;      // Different source types (interview, email, doc)
  corroboration: number;        // Do multiple sources agree?
  recency: number;              // How recent are the sources?
  completeness: number;         // Does the answer fully address the question?
}

function calculateConfidence(factors: ConfidenceFactors): number {
  const weights = {
    sourceCount: 0.15,
    topRelevance: 0.25,
    sourceDiversity: 0.15,
    corroboration: 0.20,
    recency: 0.10,
    completeness: 0.15,
  };

  return Object.entries(weights).reduce(
    (score, [key, weight]) => score + factors[key as keyof ConfidenceFactors] * weight,
    0
  );
}
```

## Teams Bot — Query Interface

### Adaptive Card for Query Response

```typescript
function buildAnswerCard(response: AgentResponse): AdaptiveCard {
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    body: [
      // Answer text
      {
        type: 'TextBlock',
        text: response.answer,
        wrap: true,
        size: 'default',
      },
      // Confidence indicator
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [{
              type: 'TextBlock',
              text: `${getConfidenceEmoji(response.confidence)} Confidence: ${Math.round(response.confidence * 100)}%`,
              size: 'small',
              color: getConfidenceColor(response.confidence),
            }],
          },
          {
            type: 'Column',
            width: 'auto',
            items: [{
              type: 'TextBlock',
              text: `Coverage: ${response.coverage}`,
              size: 'small',
            }],
          },
        ],
      },
      // Sources (expandable)
      {
        type: 'ActionSet',
        actions: [{
          type: 'Action.ShowCard',
          title: `📎 ${response.sources.length} Sources`,
          card: {
            type: 'AdaptiveCard',
            body: response.sources.map(buildSourceRow),
          },
        }],
      },
      // Follow-up suggestions
      ...(response.followUps.length > 0 ? [{
        type: 'TextBlock',
        text: '💡 Related questions:',
        size: 'small',
        weight: 'bolder',
      },
      ...response.followUps.map(q => ({
        type: 'ActionSet',
        actions: [{
          type: 'Action.Submit',
          title: q,
          data: { type: 'follow_up_query', query: q },
        }],
      }))] : []),
      // Feedback buttons
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [{
              type: 'ActionSet',
              actions: [
                { type: 'Action.Submit', title: '👍', data: { type: 'feedback', value: 'positive', queryId: response.queryId } },
                { type: 'Action.Submit', title: '👎', data: { type: 'feedback', value: 'negative', queryId: response.queryId } },
              ],
            }],
          },
        ],
      },
    ],
  };
}
```

### Bot Conversation Flow

```typescript
import { TeamsActivityHandler, TurnContext, AdaptiveCardInvokeResponse } from 'botbuilder';

class KTAgentBot extends TeamsActivityHandler {
  private queryPipeline: QueryPipeline;
  private interviewAgent: InterviewAgent;

  constructor(queryPipeline: QueryPipeline, interviewAgent: InterviewAgent) {
    super();
    this.queryPipeline = queryPipeline;
    this.interviewAgent = interviewAgent;
  }

  async onMessage(context: TurnContext): Promise<void> {
    const text = context.activity.text?.trim();
    const userId = context.activity.from.aadObjectId;

    if (!text) return;

    // Route based on conversation context
    if (await this.isInterviewSession(context)) {
      await this.interviewAgent.handleMessage(context, text);
    } else {
      // Default: query mode
      const userContext = await this.getUserContext(userId);
      const response = await this.queryPipeline.run(text, userContext);
      const card = buildAnswerCard(response);
      await context.sendActivity({ attachments: [CardFactory.adaptiveCard(card)] });
    }
  }

  async onAdaptiveCardInvoke(context: TurnContext): Promise<AdaptiveCardInvokeResponse> {
    const data = context.activity.value?.action?.data;

    switch (data?.type) {
      case 'feedback':
        await this.recordFeedback(data.queryId, data.value, context.activity.from.aadObjectId);
        return { statusCode: 200, type: 'application/vnd.microsoft.activity.message', value: 'Thanks for your feedback!' };
      
      case 'follow_up_query':
        await this.onMessage({ ...context, activity: { ...context.activity, text: data.query } } as TurnContext);
        return { statusCode: 200, type: undefined, value: undefined };
      
      default:
        return { statusCode: 200, type: undefined, value: undefined };
    }
  }
}
```

## Feedback & Improvement Loop

### Feedback Storage

```typescript
interface QueryFeedback {
  id: string;
  queryId: string;
  userId: string;
  value: 'positive' | 'negative';
  comment?: string;
  timestamp: Date;
  queryText: string;
  retrievedChunkIds: string[];
  confidence: number;
}
```

### Feedback-Driven Improvements

| Signal | Action |
|--------|--------|
| 👎 on high-confidence answer | Flag retrieved chunks for quality review |
| 👎 on low-confidence answer | Add to "knowledge gap" list for interview follow-up |
| 👍 on answer | Boost relevance of cited chunks |
| Repeated similar questions | Generate a FAQ entry |
| Zero-result queries | Flag domain as under-captured |

## End-to-End Test Scenarios

### Test 1: Interview → Store → Query

1. Conduct a mock interview about "vendor escalation process"
2. Verify chunks are created with correct entities and metadata
3. Query: "How do I escalate an issue with Contoso?"
4. Verify answer cites the interview as a source
5. Verify confidence score reflects single-source retrieval

### Test 2: Multi-Source Query

1. Load test data: interview chunk + email observation + document
2. Query: "Who handles the quarterly vendor review?"
3. Verify answer synthesizes from all three sources
4. Verify confidence is higher (multiple corroborating sources)

### Test 3: Graph Query

1. Create test entities: Person → Process → System with relationships
2. Query: "What processes does [retiree] exclusively own?"
3. Verify graph traversal returns correct results
4. Verify answer includes relationship context

### Test 4: Access Control

1. Create knowledge with sensitivity levels
2. Query as a user with department-level access
3. Verify confidential knowledge from other departments is NOT returned
4. Verify internal knowledge from same department IS returned

### Test 5: Feedback Loop

1. Submit a query, get an answer
2. Submit negative feedback
3. Verify feedback is stored with query context
4. Verify flagged chunks appear in quality review queue

## Test Criteria for Phase 3

- [ ] Query agent correctly classifies question intent
- [ ] Vector search returns semantically relevant chunks
- [ ] Graph queries return entity relationships
- [ ] Multi-source retrieval fuses results correctly
- [ ] Answer generation includes proper citations
- [ ] Confidence scoring produces reasonable values
- [ ] Teams Adaptive Card renders correctly with all components
- [ ] Feedback buttons work and store feedback
- [ ] Follow-up question buttons trigger new queries
- [ ] Access control scoping prevents unauthorized knowledge access
- [ ] Guardrails block answers with insufficient sources
- [ ] End-to-end latency < 5 seconds for typical queries
