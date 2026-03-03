# ADR-002: Knowledge Graph Storage Choice

## Status

**Accepted**

## Context

The Knowledge Transfer Agent needs to store entity relationships (people → processes → systems → decisions → workarounds). We need a storage solution that supports graph traversals, relationship queries, and integrates well with the rest of the Azure stack.

Options considered:

1. **Azure Cosmos DB — Gremlin API** (Apache TinkerPop)
2. **Neo4j on Azure** (managed or self-hosted)
3. **Pure vector approach** (embed relationships as text, rely on semantic search)
4. **Microsoft Graph connectors** (extend M365 knowledge graph)
5. **Azure SQL** with graph tables

## Decision

We will use **Azure Cosmos DB with the Gremlin API** for the knowledge graph, complemented by **Azure AI Search** for vector-based retrieval.

## Rationale

1. **Azure-native** — Cosmos DB is a first-party Azure service with Managed Identity support, private endpoints, and native integration with Azure monitoring. No separate infrastructure to manage.

2. **Serverless pricing** — Cosmos DB serverless mode is ideal for our bursty workload pattern (heavy during work hours, minimal overnight). Pay only for consumed RU/s.

3. **Gremlin API maturity** — Apache TinkerPop/Gremlin is a well-established graph query language with good tooling and community support.

4. **Multi-model advantage** — We're already using Cosmos DB (NoSQL API) for conversation history and metadata. Using the same service for the graph reduces operational complexity.

5. **Global distribution** — If the organization is multinational, Cosmos DB's multi-region replication provides low-latency access globally.

### Why not Neo4j?

Neo4j is the more powerful graph database (Cypher is more expressive than Gremlin, and Neo4j has better graph analytics). However:
- Requires managing a separate service (even Neo4j Aura adds another vendor)
- No native Azure Managed Identity integration
- Higher operational overhead for a feature we may not need at this scale
- For our use case (thousands of entities, not millions), Cosmos DB Gremlin is sufficient

### Why not pure vector?

Semantic search over embedded text works well for "what" questions but poorly for "who → what → why" traversal queries. Graph queries like "find all processes owned exclusively by the retiree that have no documentation" are natural in a graph database but awkward as vector searches.

The hybrid approach (vector for content retrieval, graph for relationship traversal) gives us the best of both worlds.

## Consequences

### Positive
- Single vendor (Azure) for all storage
- Serverless cost model
- Good enough graph capabilities for our scale
- Native Azure security integration

### Negative
- **Gremlin limitations** — Less expressive than Cypher; no built-in graph algorithms (PageRank, community detection)
- **Partition key design** — Cosmos DB requires careful partition key choice for cross-partition graph queries
- **Migration difficulty** — Moving from Cosmos DB Gremlin to another graph DB is non-trivial

### Mitigations
- Abstract graph queries behind a service layer for future portability
- If graph analytics become important, evaluate adding Neo4j as a read-replica for analytics workloads
- Use `retiree_id` as partition key and accept occasional cross-partition queries for org-wide views
