# Agent Configuration — Azure AI Foundry

## Overview

This document specifies the Azure AI Foundry agent configurations for the Knowledge Transfer Agent system.

### SDK Packages

| Package | Purpose |
|---------|---------|
| `@azure/ai-projects` | Project & resource management, agent lifecycle |
| `@azure/ai-agents` | Direct agent orchestration and tool use |
| `@azure/identity` | Authentication (`DefaultAzureCredential`) |

```typescript
// Initialization pattern
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

const endpoint = process.env.AZURE_AI_PROJECT_ENDPOINT!;
const client = new AIProjectClient(endpoint, new DefaultAzureCredential());
// Access agents via client.agents
```

## Agent Definitions

### Interview Agent

```json
{
  "name": "kt-interview-agent",
  "model": "gpt-4o",
  "description": "Conducts structured knowledge capture interviews with retiring employees",
  "system_prompt": "See prompts/interview-system-prompt.md",
  "temperature": 0.7,
  "max_tokens": 2048,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_observation_summary",
        "description": "Get a summary of recent observations for the retiree to inform interview questions",
        "parameters": {
          "type": "object",
          "properties": {
            "retiree_id": { "type": "string" },
            "domain": { "type": "string", "description": "Optional knowledge domain filter" },
            "since": { "type": "string", "format": "date", "description": "Observations since this date" }
          },
          "required": ["retiree_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_coverage_gaps",
        "description": "Get uncovered knowledge domains and suggested questions",
        "parameters": {
          "type": "object",
          "properties": {
            "retiree_id": { "type": "string" },
            "top_n": { "type": "integer", "default": 5 }
          },
          "required": ["retiree_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "save_knowledge_chunk",
        "description": "Save a captured knowledge item from the interview",
        "parameters": {
          "type": "object",
          "properties": {
            "content": { "type": "string" },
            "knowledge_type": { "type": "string", "enum": ["tacit", "explicit", "relational"] },
            "domain": { "type": "string" },
            "entities": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "text": { "type": "string" },
                  "type": { "type": "string" }
                }
              }
            }
          },
          "required": ["content", "knowledge_type", "domain"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_session_history",
        "description": "Get history of previous interview sessions with this retiree",
        "parameters": {
          "type": "object",
          "properties": {
            "retiree_id": { "type": "string" },
            "last_n_sessions": { "type": "integer", "default": 3 }
          },
          "required": ["retiree_id"]
        }
      }
    }
  ],
  "conversation_config": {
    "max_turns_per_session": 30,
    "session_timeout_minutes": 60,
    "persist_history": true
  }
}
```

### Query Agent

```json
{
  "name": "kt-query-agent",
  "model": "gpt-4o",
  "description": "Answers questions about institutional knowledge using RAG",
  "system_prompt": "See prompts/query-system-prompt.md",
  "temperature": 0.3,
  "max_tokens": 2048,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search_knowledge",
        "description": "Search the knowledge base using hybrid vector + keyword search",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "The search query" },
            "domain_filter": { "type": "string", "description": "Optional domain filter" },
            "retiree_filter": { "type": "string", "description": "Optional retiree ID filter" },
            "source_type_filter": { "type": "string", "enum": ["interview", "observation", "document"] },
            "top_k": { "type": "integer", "default": 10 }
          },
          "required": ["query"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "query_knowledge_graph",
        "description": "Query the knowledge graph for entity relationships",
        "parameters": {
          "type": "object",
          "properties": {
            "entity_name": { "type": "string" },
            "relationship_type": { "type": "string", "enum": ["owns", "contacts", "uses", "decided", "depends_on", "has_workaround", "escalates_to"] },
            "direction": { "type": "string", "enum": ["outgoing", "incoming", "both"], "default": "both" },
            "max_depth": { "type": "integer", "default": 2 }
          },
          "required": ["entity_name"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_document_context",
        "description": "Get context about a SharePoint/OneDrive document",
        "parameters": {
          "type": "object",
          "properties": {
            "document_url": { "type": "string" },
            "document_name": { "type": "string" }
          }
        }
      }
    }
  ],
  "conversation_config": {
    "max_turns_per_session": 20,
    "session_timeout_minutes": 30,
    "persist_history": true
  }
}
```

## Model Parameters Rationale

| Parameter | Interview Agent | Query Agent | Rationale |
|-----------|----------------|-------------|-----------|
| **Temperature** | 0.7 | 0.3 | Interviews need more creative questioning; queries need precise, factual answers |
| **Max tokens** | 2048 | 2048 | Both need room for detailed responses |
| **Model** | GPT-4o | GPT-4o | Best quality for nuanced conversations and accurate RAG |

## Scaling Considerations

- **Token budget:** ~30K TPM (tokens per minute) for GPT-4o should handle 5-10 concurrent users
- **Embedding budget:** ~120K TPM for text-embedding-3-large handles batch + real-time embedding
- **Scale-up triggers:** If concurrent users exceed 10, increase GPT-4o capacity or add queue-based processing
- **Cost optimization:** Consider GPT-4o-mini for entity extraction and quality scoring (cheaper, sufficient quality)
