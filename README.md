# Knowledge Transfer Agent

> An AI agent architecture for capturing institutional knowledge from retiring employees — built on the Microsoft stack.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The Problem

When long-tenured employees retire, organizations lose decades of critical institutional knowledge:

- **Tacit knowledge** — Why decisions were made, unwritten rules, "the way things actually work"
- **Explicit knowledge** — Documents, runbooks, configurations, code ownership
- **Relationship context** — Who to call, vendor contacts, escalation paths, political dynamics

Traditional knowledge transfer (shadowing, exit interviews, wiki dumps) captures only a fraction. The rest walks out the door.

## The Solution

An AI-powered agent system that:

1. **Passively observes** the retiree's digital work patterns via Microsoft 365
2. **Conducts structured interviews** with adaptive questioning to fill knowledge gaps
3. **Builds a queryable knowledge base** that colleagues can ask questions to
4. **Evolves into a "digital coworker"** that can autonomously execute tasks the retiree used to handle

## Architecture Overview

```mermaid
graph TB
    subgraph "👤 Knowledge Sources"
        R[Retiring Employee]
        M365[Microsoft 365<br/>Emails, Teams, SharePoint,<br/>Calendar, OneDrive]
    end

    subgraph "🔍 Extraction Layer"
        PO[Passive Observer<br/><i>M365 Copilot + Graph API</i>]
        IA[Interview Agent<br/><i>Azure AI Foundry</i>]
        RM[Relationship Mapper<br/><i>Graph API Social Analysis</i>]
    end

    subgraph "⚙️ Processing Layer"
        CE[Chunking & Embedding<br/><i>Azure OpenAI Service</i>]
        EE[Entity Extraction<br/><i>Azure AI Language</i>]
        KGB[Knowledge Graph Builder<br/><i>Graph Connectors</i>]
    end

    subgraph "💾 Storage Layer"
        VS[Vector Store<br/><i>Azure AI Search</i>]
        KG[Knowledge Graph<br/><i>Azure Cosmos DB<br/>Gremlin API</i>]
        DS[Document Store<br/><i>SharePoint + Metadata</i>]
        CS[Conversation Store<br/><i>Azure Cosmos DB</i>]
    end

    subgraph "🤖 Serving Layer"
        QA[Query Agent<br/><i>Azure AI Foundry RAG</i>]
        TB[Teams Bot<br/><i>Bot Framework</i>]
        CP[Copilot Plugin<br/><i>M365 Copilot</i>]
    end

    subgraph "🔮 Future: Digital Coworker"
        TE[Task Execution<br/><i>Power Automate</i>]
        AW[Autonomous Workflows]
        HL[Human-in-the-Loop<br/><i>Teams Adaptive Cards</i>]
    end

    subgraph "🔒 Governance"
        EID[Entra ID — AuthN/AuthZ]
        PV[Purview — Data Classification]
        AL[Audit Logging]
    end

    R -->|Daily work| M365
    M365 -->|Graph API| PO
    R -->|Interview sessions| IA
    M365 -->|Social graph| RM

    PO --> CE
    IA --> CE
    RM --> KGB
    CE --> EE
    EE --> KGB

    CE --> VS
    KGB --> KG
    PO --> DS
    IA --> CS

    VS --> QA
    KG --> QA
    DS --> QA
    CS --> QA

    QA --> TB
    QA --> CP
    QA -.->|Phase 2| TE
    TE -.-> AW
    AW -.-> HL

    EID -.->|Secures| QA
    EID -.->|Secures| PO
    PV -.->|Classifies| VS
    PV -.->|Classifies| KG
    AL -.->|Monitors| QA
    AL -.->|Monitors| TE

    style R fill:#4A90D9,color:#fff
    style QA fill:#2ECC71,color:#fff
    style TE fill:#F39C12,color:#fff
    style EID fill:#E74C3C,color:#fff
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Observation** | Microsoft Graph API | Monitor work patterns, extract from emails/docs/meetings |
| **Interviews** | Azure AI Foundry (`@azure/ai-projects`) | Orchestrate adaptive interview sessions |
| **Embeddings** | Azure OpenAI Service | Generate text embeddings for semantic search |
| **Entity Extraction** | Azure AI Language | Named entity recognition (people, processes, systems) |
| **Vector Search** | Azure AI Search | Hybrid vector + keyword search over knowledge base |
| **Knowledge Graph** | Azure Cosmos DB (Gremlin API — separate account) | Relationship data: people → processes → systems → decisions |
| **Documents** | SharePoint / OneDrive | Original artifacts with enriched metadata |
| **Agent Interface** | Teams SDK (Teams AI Library), Teams | Natural language access for colleagues |
| **Copilot Integration** | M365 Copilot Plugins | Contextual knowledge surfacing in daily work |
| **Task Automation** | Power Automate | Autonomous task execution (future phase) |
| **Identity** | Microsoft Entra ID | Authentication and role-based access control |
| **Compliance** | Microsoft Purview | Data classification and sensitivity labeling |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture Overview](docs/architecture-overview.md) | Detailed multi-level architecture with C4-style diagrams |
| [Extraction Layer](docs/components/extraction-layer.md) | Passive observer + interview agent design |
| [Processing Layer](docs/components/processing-layer.md) | Chunking, embedding, entity extraction pipeline |
| [Storage Layer](docs/components/storage-layer.md) | Vector store, knowledge graph, document store |
| [Serving Layer](docs/components/serving-layer.md) | Query agent, Teams bot, Copilot plugin |
| [Digital Coworker](docs/components/digital-coworker.md) | Future autonomous agent capabilities |
| [Data Model](docs/data-model.md) | Entity relationships and schema design |
| [Security & Governance](docs/security-governance.md) | Auth, RBAC, consent, compliance |
| [User Journeys](docs/user-journeys.md) | Retiree, colleague, and admin experiences |
| [Feasibility Review](docs/feasibility-review.md) | Technical feasibility review with identified issues and fixes |
| [ADRs](docs/adr/) | Architecture Decision Records |
| [MVP Plan](mvp-plan/) | Phased implementation plan for building an MVP |

## Key Design Decisions

- **[ADR-001](docs/adr/001-microsoft-stack.md)** — Why the Microsoft stack (vs. AWS/GCP/multi-cloud)
- **[ADR-002](docs/adr/002-knowledge-graph-choice.md)** — Cosmos DB Gremlin vs. Neo4j vs. pure vector approach
- **[ADR-003](docs/adr/003-hybrid-extraction.md)** — Why both passive observation AND structured interviews

## Getting Started

This repository contains architecture documentation and an MVP implementation plan. There is no application code yet — the [MVP Plan](mvp-plan/) provides detailed technical specifications that a development team or coding agent can use to build Phase 1.

### Prerequisites for MVP Development

- Azure subscription with Azure AI Foundry access
- Microsoft 365 tenant with Graph API permissions
- Microsoft Entra ID for identity management
- Node.js 20+ / Python 3.11+ (language TBD in MVP phase)

## Development Setup

### Prerequisites
- Node.js 20+
- Azure subscription with the following resources (see [Infrastructure](infra/README.md))
- Microsoft 365 tenant for Teams bot testing

### Quick Start

1. Clone the repository:
```bash
git clone https://github.com/jnscnn/knowledge-transfer-agent.git
cd knowledge-transfer-agent
```

2. Install dependencies:
```bash
npm install
```

3. Deploy Azure infrastructure:
```bash
az group create --name kt-agent-rg --location eastus2
az deployment group create \
  --resource-group kt-agent-rg \
  --template-file infra/main.bicep \
  --parameters infra/parameters/dev.bicepparam
```

4. Copy environment variables:
```bash
cp .env.example .env
# Fill in values from Azure deployment outputs
```

5. Initialize storage:
```bash
npm run setup:search-index
npm run setup:cosmos
```

6. Start the bot:
```bash
npm run dev
```

7. Run tests:
```bash
npm test
```

### Project Structure

```
src/
├── shared/          # Types, config, errors, retry, logging
├── storage/         # Cosmos DB, AI Search, Gremlin clients
├── pipeline/        # Chunking, embedding, entity extraction, indexing
├── agents/
│   ├── interview/   # Interview agent (knowledge capture)
│   └── query/       # Query agent (RAG pipeline)
├── graph/           # Microsoft Graph API observer
├── bot/             # Teams bot (cards, handlers, manifest)
└── index.ts         # Application entry point

functions/           # Azure Functions (event processing)
infra/               # Bicep templates (Azure infrastructure)
tests/               # Unit and integration tests
```

## Contributing

This is an open architecture proposal. Feedback, suggestions, and contributions are welcome:

1. Open an [issue](https://github.com/jnscnn/knowledge-transfer-agent/issues) to discuss ideas
2. Submit a PR for documentation improvements
3. Star the repo if you find the concept valuable

## License

[MIT](LICENSE)
