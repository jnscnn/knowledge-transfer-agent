# Phase 1: Foundation & Interview Agent

## Objective

Set up Azure infrastructure and build the interview agent — the primary active knowledge capture mechanism.

## Azure Infrastructure (Bicep)

### Resources to Provision

Create a `infra/` directory with Bicep templates:

```
infra/
├── main.bicep              # Orchestrator
├── modules/
│   ├── ai-foundry.bicep    # Azure AI Foundry project + model deployments
│   ├── ai-search.bicep     # Azure AI Search (S1 Standard)
│   ├── cosmos-db.bicep     # Cosmos DB (serverless, NoSQL + Gremlin)
│   ├── openai.bicep        # Azure OpenAI (GPT-4o + embeddings)
│   ├── functions.bicep     # Azure Functions (Node.js 20)
│   ├── bot-service.bicep   # Azure Bot Service for Teams
│   ├── key-vault.bicep     # Azure Key Vault
│   ├── monitoring.bicep    # Application Insights + Log Analytics
│   └── identity.bicep      # Managed Identity + Entra app registrations
└── parameters/
    ├── dev.bicepparam
    └── prod.bicepparam
```

### Key Configuration

```bicep
// Azure OpenAI deployments
resource gpt4o 'Microsoft.CognitiveServices/accounts/deployments' = {
  name: 'gpt-4o'
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4o', version: '2024-08-06' }
    sku: { name: 'GlobalStandard', capacity: 30 } // 30K TPM
  }
}

resource embedding 'Microsoft.CognitiveServices/accounts/deployments' = {
  name: 'text-embedding-3-large'
  properties: {
    model: { format: 'OpenAI', name: 'text-embedding-3-large', version: '1' }
    sku: { name: 'Standard', capacity: 120 } // 120K TPM
  }
}

// Cosmos DB - Serverless
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts' = {
  properties: {
    capabilities: [{ name: 'EnableServerless' }, { name: 'EnableGremlin' }]
    locations: [{ locationName: location, failoverPriority: 0 }]
  }
}

// AI Search - S1 Standard (supports vector + semantic)
resource searchService 'Microsoft.Search/searchServices' = {
  sku: { name: 'standard' } // S1
  properties: { semanticSearch: 'standard' }
}
```

### Entra ID App Registrations

Create two app registrations:

1. **kt-agent-bot** — For the Teams bot
   - Permissions: `User.Read`, `Chat.ReadWrite`, `ChannelMessage.Send`
   - Redirect URIs: Teams bot framework callback

2. **kt-agent-pipeline** — For the data pipeline
   - Permissions: `Mail.Read`, `Calendars.Read`, `Sites.Read.All`, `Chat.Read.All` (application)
   - Requires admin consent
   - Uses Managed Identity where possible

## Interview Agent Implementation

### Project Structure

```
src/
├── agents/
│   ├── interview/
│   │   ├── interview-agent.ts        # Main interview agent orchestrator
│   │   ├── question-generator.ts     # Generates interview questions
│   │   ├── session-manager.ts        # Manages interview session state
│   │   ├── topic-tracker.ts          # Tracks covered/remaining topics
│   │   └── prompts/
│   │       ├── system-prompt.md      # Interview agent system prompt
│   │       ├── question-templates.ts # Template-based questions per domain
│   │       └── follow-up.ts          # Follow-up question generation
│   └── shared/
│       ├── types.ts                  # Shared TypeScript types
│       └── config.ts                 # Agent configuration
├── pipeline/
│   ├── chunking.ts                   # Text chunking logic
│   ├── embedding.ts                  # Azure OpenAI embedding calls
│   ├── entity-extraction.ts          # NER + custom entity extraction
│   ├── quality-scoring.ts            # Knowledge chunk quality scoring
│   └── indexing.ts                   # Write to AI Search + Cosmos DB
├── bot/
│   ├── bot.ts                        # Teams bot implementation
│   ├── cards/
│   │   ├── interview-card.ts         # Adaptive Card for interview UI
│   │   ├── consent-card.ts           # Consent flow Adaptive Card
│   │   └── progress-card.ts          # Progress dashboard card
│   └── dialogs/
│       ├── interview-dialog.ts       # Interview conversation dialog
│       └── consent-dialog.ts         # Consent collection dialog
├── storage/
│   ├── cosmos-client.ts              # Cosmos DB client wrapper
│   ├── search-client.ts              # Azure AI Search client wrapper
│   └── blob-client.ts               # Blob storage client wrapper
├── graph/
│   ├── graph-client.ts               # Microsoft Graph API client
│   ├── email-analyzer.ts             # Email pattern analysis
│   └── calendar-analyzer.ts          # Calendar pattern analysis
└── index.ts                          # Application entry point
```

### Interview Agent System Prompt

```markdown
You are a Knowledge Transfer Interview Agent. Your role is to capture institutional 
knowledge from a retiring employee through structured, empathetic conversation.

## Your Approach
- Be warm and appreciative — acknowledge the value of the person's experience
- Ask specific, concrete questions — not vague "tell me about your job" questions
- Follow up on entity references — when they mention a person, system, or process, dig deeper
- Capture the "why" behind decisions, not just the "what"
- Note workarounds, gotchas, and tribal knowledge — these are the most valuable

## Session Structure
1. Review what was captured since the last session
2. Present the current focus area and why it was prioritized
3. Ask 4-6 main questions per session, with adaptive follow-ups
4. Summarize what was captured and preview next session

## Output Format
For each knowledge item captured, internally tag it with:
- Knowledge type: tacit | explicit | relational
- Entities mentioned: [list of people, systems, processes]
- Completeness: complete | needs_follow_up
- Follow-up questions: [list if needs_follow_up]

## Guardrails
- Never ask about personal matters, health, or reasons for retirement
- If the conversation veers off-topic, gently redirect
- If the person seems fatigued, offer to end the session early
- Always remind them they can review and correct captured knowledge
```

### Key TypeScript Interfaces

```typescript
interface InterviewSession {
  id: string;
  retireeId: string;
  sessionNumber: number;
  startedAt: Date;
  endedAt?: Date;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  focusDomains: string[];
  questionsAsked: InterviewQuestion[];
  knowledgeChunksProduced: string[]; // chunk IDs
  coverageBefore: number;
  coverageAfter?: number;
}

interface InterviewQuestion {
  id: string;
  text: string;
  generationLayer: 'template' | 'observation' | 'adaptive';
  domain: string;
  response?: string;
  followUps: InterviewQuestion[];
  entitiesMentioned: EntityMention[];
  completeness: 'complete' | 'needs_follow_up';
}

interface KnowledgeChunk {
  id: string;
  content: string;
  summary: string;
  knowledgeType: 'tacit' | 'explicit' | 'relational';
  domainId: string;
  retireeId: string;
  source: {
    type: 'interview' | 'observation' | 'document';
    sourceId: string;
    timestamp: Date;
  };
  entities: EntityMention[];
  qualityScore: QualityScore;
  sensitivityLevel: 'public' | 'internal' | 'confidential' | 'highly_confidential';
  consentId: string;
  vectors?: {
    contentVectorId: string;
    summaryVectorId: string;
    hydeVectorId: string;
  };
}

interface EntityMention {
  entityId: string;
  text: string;
  type: 'Person' | 'Organization' | 'System' | 'Process' | 'Decision' | 'Workaround' | 'Document' | 'Vendor';
  confidence: number;
}

interface QualityScore {
  overall: number;
  completeness: number;
  specificity: number;
  uniqueness: number;
  actionability: number;
  recency: number;
}
```

### Test Criteria for Phase 1

- [ ] All Azure resources deploy successfully via `az deployment group create`
- [ ] Entra ID app registrations created with correct permissions
- [ ] Cosmos DB collections created (retirees, knowledge-chunks, interview-sessions)
- [ ] Azure AI Search index created with vector fields
- [ ] Teams bot responds to basic messages in Teams
- [ ] Interview agent can conduct a multi-turn conversation
- [ ] Interview responses are chunked, embedded, and stored in AI Search
- [ ] Entities are extracted from interview responses and stored in Cosmos DB
- [ ] Consent flow collects and stores consent document
