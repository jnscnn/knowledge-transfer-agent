# Architecture Overview

This document provides a detailed, multi-level view of the Knowledge Transfer Agent architecture. It follows a C4-style approach: System Context → Container → Component.

## System Context

The Knowledge Transfer Agent operates within an organization's Microsoft 365 ecosystem, interacting with retiring employees, their colleagues, and IT administrators.

```mermaid
graph LR
    subgraph "Organization"
        RE["👤 Retiring Employee<br/><i>Knowledge source</i>"]
        CO["👥 Colleagues<br/><i>Knowledge consumers</i>"]
        AD["🔧 IT Admin<br/><i>System governance</i>"]
    end

    KTA["🤖 Knowledge Transfer<br/>Agent System"]

    M365["☁️ Microsoft 365<br/>Tenant"]
    AZURE["☁️ Azure Cloud<br/>Services"]

    RE -->|"Participates in interviews<br/>Consents to observation"| KTA
    CO -->|"Asks questions<br/>Receives knowledge"| KTA
    AD -->|"Configures policies<br/>Monitors compliance"| KTA
    KTA <-->|"Graph API<br/>Copilot APIs"| M365
    KTA <-->|"AI Services<br/>Storage<br/>Compute"| AZURE

    style KTA fill:#2ECC71,color:#fff,stroke:#27AE60,stroke-width:3px
    style M365 fill:#0078D4,color:#fff
    style AZURE fill:#0078D4,color:#fff
```

## Container Diagram

Breaking the system into its major runtime containers:

```mermaid
graph TB
    subgraph "Client Layer"
        TEAMS["Microsoft Teams<br/><i>Primary UI</i>"]
        M365C["M365 Copilot<br/><i>Contextual surfacing</i>"]
        WEB["Web Dashboard<br/><i>Admin & Analytics</i>"]
    end

    subgraph "Agent Orchestration" 
        direction TB
        ORCH["Agent Orchestrator<br/><i>Azure AI Foundry</i><br/><br/>Routes requests,<br/>manages agent lifecycle,<br/>coordinates multi-step flows"]
        
        subgraph "Specialized Agents"
            INT_A["Interview Agent<br/><i>Conducts structured<br/>knowledge capture sessions</i>"]
            QUERY_A["Query Agent<br/><i>Answers questions using<br/>RAG over knowledge base</i>"]
            OBS_A["Observer Agent<br/><i>Monitors work patterns<br/>identifies knowledge gaps</i>"]
            TASK_A["Task Agent<br/><i>Future: executes<br/>autonomous workflows</i>"]
        end
    end

    subgraph "Data Pipeline"
        INGEST["Ingestion Service<br/><i>Azure Functions</i><br/><br/>Graph API webhooks,<br/>event processing"]
        PROCESS["Processing Pipeline<br/><i>Azure Functions</i><br/><br/>Chunking, embedding,<br/>entity extraction"]
    end

    subgraph "Storage"
        SEARCH["Azure AI Search<br/><i>Vector + keyword index</i>"]
        COSMOS["Azure Cosmos DB<br/><i>Knowledge graph (Gremlin) +<br/>metadata (NoSQL) —<br/>2 separate accounts</i>"]
        SP["SharePoint<br/><i>Document artifacts</i>"]
    end

    subgraph "Platform Services"
        AOAI["Azure OpenAI<br/><i>GPT-4o, Embeddings</i>"]
        LANG["Azure AI Language<br/><i>NER, Key Phrase</i>"]
        GRAPH["Microsoft Graph API<br/><i>M365 data access</i>"]
        ENTRA["Microsoft Entra ID<br/><i>Identity & RBAC</i>"]
    end

    TEAMS --> ORCH
    M365C --> ORCH
    WEB --> ORCH

    ORCH --> INT_A
    ORCH --> QUERY_A
    ORCH --> OBS_A
    ORCH -.-> TASK_A

    INT_A --> AOAI
    QUERY_A --> AOAI
    QUERY_A --> SEARCH
    QUERY_A --> COSMOS
    OBS_A --> GRAPH

    INGEST --> GRAPH
    INGEST --> PROCESS
    PROCESS --> AOAI
    PROCESS --> LANG
    PROCESS --> SEARCH
    PROCESS --> COSMOS
    PROCESS --> SP

    ORCH --> ENTRA

    style ORCH fill:#2ECC71,color:#fff
    style TASK_A fill:#F39C12,color:#fff,stroke-dasharray: 5 5
    style SEARCH fill:#9B59B6,color:#fff
    style COSMOS fill:#9B59B6,color:#fff
```

## Component Detail: Agent Orchestrator

The orchestrator is the brain of the system. It routes incoming requests to specialized agents and manages multi-step workflows.

```mermaid
graph TB
    subgraph "Agent Orchestrator — Azure AI Foundry"
        ROUTER["Request Router<br/><i>Classifies intent,<br/>selects agent</i>"]
        CTX["Context Manager<br/><i>Maintains conversation<br/>state and history</i>"]
        TOOLS["Tool Registry<br/><i>Graph API, Search,<br/>Power Automate</i>"]
        GUARD["Guardrails<br/><i>Content safety,<br/>PII redaction,<br/>scope enforcement</i>"]
        EVAL["Evaluation Loop<br/><i>Answer quality,<br/>relevance scoring,<br/>hallucination detection</i>"]
    end

    IN["Incoming Request"]
    OUT["Response"]

    IN --> ROUTER
    ROUTER --> CTX
    CTX --> TOOLS
    TOOLS --> GUARD
    GUARD --> EVAL
    EVAL --> OUT
    EVAL -->|"Insufficient quality"| CTX

    style ROUTER fill:#3498DB,color:#fff
    style GUARD fill:#E74C3C,color:#fff
    style EVAL fill:#F39C12,color:#fff
```

## Data Flow: Knowledge Capture

End-to-end flow from knowledge source to queryable knowledge base:

```mermaid
sequenceDiagram
    participant RE as Retiring Employee
    participant M365 as Microsoft 365
    participant OBS as Observer Agent
    participant INT as Interview Agent
    participant PIPE as Processing Pipeline
    participant STORE as Knowledge Store
    participant QA as Query Agent
    participant COL as Colleague

    Note over RE,M365: Phase 1: Passive Observation
    RE->>M365: Daily work (emails, meetings, docs)
    M365->>OBS: Graph API change notifications
    OBS->>OBS: Analyze patterns, identify<br/>knowledge domains
    OBS->>PIPE: Raw observations + metadata

    Note over RE,INT: Phase 2: Structured Interviews
    OBS->>INT: Knowledge gap report
    INT->>RE: "Tell me about the vendor<br/>escalation process for Contoso..."
    RE->>INT: Detailed explanation + context
    INT->>INT: Follow-up questions based<br/>on gaps and entity references
    INT->>PIPE: Interview transcripts + annotations

    Note over PIPE,STORE: Phase 3: Processing & Storage
    PIPE->>PIPE: Chunk → Embed → Extract entities
    PIPE->>STORE: Vectors → Azure AI Search
    PIPE->>STORE: Entities → Cosmos DB graph
    PIPE->>STORE: Documents → SharePoint

    Note over QA,COL: Phase 4: Knowledge Serving
    COL->>QA: "Who handles Contoso escalations<br/>and what's the process?"
    QA->>STORE: Hybrid search (vector + graph)
    STORE->>QA: Relevant chunks + entity context
    QA->>COL: Structured answer with sources<br/>and confidence score
```

## Data Flow: Knowledge Query

How a colleague's question gets answered:

```mermaid
graph LR
    Q["❓ Question via<br/>Teams / Copilot"]
    
    subgraph "Query Agent Pipeline"
        PARSE["Intent<br/>Parsing"]
        REWRITE["Query<br/>Rewriting"]
        
        subgraph "Parallel Retrieval"
            VEC["Vector<br/>Search"]
            GRAPH_Q["Graph<br/>Traversal"]
            DOC_Q["Document<br/>Lookup"]
        end
        
        RANK["Reranking &<br/>Fusion"]
        GEN["Answer<br/>Generation"]
        CITE["Citation<br/>Attachment"]
    end

    A["✅ Answer with<br/>sources & confidence"]

    Q --> PARSE --> REWRITE
    REWRITE --> VEC
    REWRITE --> GRAPH_Q
    REWRITE --> DOC_Q
    VEC --> RANK
    GRAPH_Q --> RANK
    DOC_Q --> RANK
    RANK --> GEN --> CITE --> A

    style Q fill:#3498DB,color:#fff
    style A fill:#2ECC71,color:#fff
    style RANK fill:#9B59B6,color:#fff
```

## Deployment Architecture

```mermaid
graph TB
    subgraph "Azure Resource Group: kt-agent-prod"
        subgraph "Compute"
            FOUNDRY["Azure AI Foundry<br/><i>Agent hosting</i>"]
            FUNC["Azure Functions<br/><i>Event processing<br/>Data pipeline</i>"]
        end

        subgraph "Data"
            SEARCH["Azure AI Search<br/><i>S1 Standard</i>"]
            COSMOS_NOSQL["Cosmos DB NoSQL<br/><i>Serverless</i>"]
            COSMOS_GRAPH["Cosmos DB Gremlin<br/><i>Serverless</i>"]
            BLOB["Azure Blob Storage<br/><i>Raw data lake</i>"]
        end

        subgraph "AI"
            AOAI_D["Azure OpenAI<br/><i>GPT-4o + text-embedding-3-large</i>"]
            LANG_D["Azure AI Language<br/><i>NER + Key Phrases</i>"]
        end

        subgraph "Security"
            KV["Azure Key Vault<br/><i>Secrets & certificates</i>"]
            ENTRA_D["Microsoft Entra ID<br/><i>App registrations</i>"]
            PV["Microsoft Purview<br/><i>Data governance</i>"]
        end

        subgraph "Monitoring"
            AI_MON["Application Insights<br/><i>Telemetry & tracing</i>"]
            LOG["Log Analytics<br/><i>Audit logs</i>"]
        end
    end

    subgraph "Microsoft 365 Tenant"
        TEAMS_D["Teams<br/><i>Bot deployment</i>"]
        SP_D["SharePoint<br/><i>Document storage</i>"]
        GRAPH_D["Graph API<br/><i>Data access</i>"]
    end

    FOUNDRY <--> AOAI_D
    FOUNDRY <--> SEARCH
    FOUNDRY <--> COSMOS_NOSQL
    FOUNDRY <--> COSMOS_GRAPH
    FUNC <--> GRAPH_D
    FUNC <--> SEARCH
    FUNC <--> COSMOS_NOSQL
    FUNC <--> COSMOS_GRAPH
    FUNC <--> AOAI_D
    FUNC <--> LANG_D
    FOUNDRY <--> TEAMS_D
    FUNC --> BLOB
    FUNC --> SP_D
    FOUNDRY --> KV
    FUNC --> KV
    AI_MON -.-> FOUNDRY
    AI_MON -.-> FUNC
    LOG -.-> ENTRA_D
    PV -.-> SEARCH
    PV -.-> COSMOS_NOSQL
    PV -.-> COSMOS_GRAPH

    style FOUNDRY fill:#2ECC71,color:#fff
    style AOAI_D fill:#0078D4,color:#fff
    style ENTRA_D fill:#E74C3C,color:#fff
```

## Cross-Cutting Concerns

### Authentication & Authorization Flow

```mermaid
sequenceDiagram
    participant U as User
    participant T as Teams Client
    participant E as Entra ID
    participant O as Orchestrator
    participant G as Graph API

    U->>T: Opens KT Agent bot
    T->>E: SSO token request
    E->>T: Access token (user scope)
    T->>O: Query + user token
    O->>E: Validate token, check RBAC
    E->>O: User roles & permissions
    O->>O: Apply data access policies<br/>(which retiree's knowledge<br/>can this user access?)
    O->>G: On-behalf-of token exchange
    G->>O: Delegated data access
    O->>T: Scoped response
```

### Key Architectural Principles

1. **Privacy by Design** — The retiree explicitly consents to observation scope; all data is classified via Purview
2. **Least Privilege** — Each component has minimal Graph API permissions; data access is role-scoped
3. **Auditability** — Every agent action is logged; answers include source attribution
4. **Graceful Degradation** — If a component fails, the agent returns partial results with confidence indicators
5. **Human-in-the-Loop** — High-stakes actions (especially in the digital coworker phase) require explicit approval
