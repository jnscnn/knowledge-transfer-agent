# Feasibility Review — MVP Implementation Plan

> Reviewed: March 2026  
> Status: **Several critical issues identified** that must be resolved before implementation

## Summary

The architecture is conceptually sound and well-structured. However, a detailed review against current Azure service capabilities reveals **3 critical blockers**, **4 significant issues**, and **3 moderate issues** that would prevent the MVP from being runnable as documented.

---

## 🔴 CRITICAL — Blockers

### 1. Cosmos DB: Cannot use both NoSQL API and Gremlin API in a single account

**The Problem:**  
The Bicep template (`cosmos-db.bicep`) creates a single Cosmos DB account with capabilities `[EnableServerless, EnableGremlin]`, then creates **both** NoSQL (`sqlDatabases`) and Gremlin (`gremlinDatabases`) resources on it. This is **not possible**.

Cosmos DB accounts are **API-specific**. When you create an account with the Gremlin API, you cannot create SQL/NoSQL databases on it, and vice versa. These are fundamentally different wire protocols and data models.

**Impact:** The entire storage layer architecture is unbuildable as documented.

**Fix:**  
Create **two separate Cosmos DB accounts**:
- `kt-cosmos-nosql-{suffix}` — Serverless, NoSQL API for documents (knowledge chunks, interview sessions, observations, queries, consent)
- `kt-cosmos-graph-{suffix}` — Serverless, Gremlin API for the knowledge graph

Update the Bicep, environment variables, and all code that references a single Cosmos DB endpoint.

**Alternative:** Drop Cosmos DB Gremlin entirely and use **Azure Cosmos DB for NoSQL with a graph-like data model** (storing edges as documents with source/target references). This is simpler but loses native Gremlin traversal queries. For the MVP scale (~5K vertices per retiree), this may be sufficient and is much simpler to operate.

---

### 2. Bot Framework SDK v4 is archived — use Teams SDK instead

**The Problem:**  
The plan specifies `Bot Framework SDK v4 + Teams AI Library` with `TeamsActivityHandler` from `botbuilder`. Microsoft has **officially archived** the Bot Framework SDK and Emulator. No support after December 31, 2025. The code samples use deprecated patterns.

**Impact:** Building on a dead framework means no security patches, no bug fixes, and a forced migration within months of launch.

**Fix:**  
Replace Bot Framework SDK v4 with the **Teams SDK (formerly Teams AI Library)**:
- NPM package: `@microsoft/teams-ai` → now `@microsoft/teams-sdk`
- Use `Application` class instead of `TeamsActivityHandler`
- Native LLM integration, conversation state management, and prompt management built-in
- Active open-source development on [github.com/microsoft/teams-sdk](https://github.com/microsoft/teams-sdk)

All bot code samples in Phase 1 and Phase 3 need rewriting to the Teams SDK API.

---

### 3. `Chat.Read.All` is a protected API requiring Microsoft approval

**The Problem:**  
The Graph API permissions doc lists `Chat.Read.All` as a standard application permission. In reality, it is a **protected API** in the Teams context. You must:
1. Submit a formal request to Microsoft with a business justification
2. Wait for manual approval (can take weeks)
3. This is tenant-wide — no way to scope to just the retiree's chats

**Impact:** This is a significant enterprise deployment blocker. Customer IT admins will resist granting tenant-wide chat read access. The approval process adds unpredictable delays.

**Fix:**  
- **For MVP:** Remove Teams chat observation from the initial scope. Email + calendar + OneDrive/SharePoint observation is sufficient and uses standard permissions.
- **For future phases:** Use **Resource-Specific Consent (RSC)** instead, which allows scoped permission per chat/team. The retiree can consent to their own chats being observed without tenant-wide access.
- Update the permissions doc to reflect this phased approach.

---

## 🟡 SIGNIFICANT — Must fix before coding

### 4. Azure AI Foundry SDK package names and API shape are incorrect

**The Problem:**  
The plan references a generic "Azure AI Foundry SDK" without specifying actual packages. The agent configuration JSON format shown doesn't match the real SDK.

**Fix:**  
- Use `@azure/ai-projects` for project/resource management
- Use `@azure/ai-agents` for agent orchestration
- Authentication: `DefaultAzureCredential` from `@azure/identity`
- The agent definition format should follow the actual SDK:

```typescript
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

const client = new AIProjectClient(endpoint, new DefaultAzureCredential());
// Create agent via client.agents API
```

Update `agent-config.md` and all TypeScript samples to use actual SDK APIs.

---

### 5. Azure AI Foundry has no dedicated Bicep resource provider

**The Problem:**  
The infrastructure plan includes `ai-foundry.bicep` but there is no `Microsoft.AIFoundry` resource provider. Azure AI Foundry uses `Microsoft.MachineLearningServices` workspaces under the hood.

**Fix:**  
Replace `ai-foundry.bicep` with a proper ML workspace deployment:

```bicep
resource aiProject 'Microsoft.MachineLearningServices/workspaces@2024-10-01' = {
  name: 'kt-ai-project-${suffix}'
  location: location
  kind: 'Project'
  sku: { name: 'Basic', tier: 'Basic' }
  properties: {
    friendlyName: 'KT Agent Project'
    hubResourceId: aiHub.id  // Requires an AI Hub parent
  }
}
```

This also requires creating an **AI Hub** resource first, which has its own dependencies (Storage Account, Key Vault, Application Insights). The Bicep template is significantly under-specified here.

---

### 6. Bicep API versions are outdated or preview

**The Problem:**  
Templates use `2024-04-01-preview` and `2024-02-15-preview` API versions. For a customer project, use GA (stable) versions.

**Fix:**  
- Cosmos DB: Use `2024-11-15` (latest stable)
- Azure OpenAI: Use `2024-10-01` (latest stable)
- AI Search: Use `2024-07-01` (latest stable)
- Use `az bicep list-versions` and Microsoft docs to pin to latest stable

---

### 7. AI Search SDK API inconsistencies in code samples

**The Problem:**  
The index schema uses `vectorSearchProfileName` (correct) but the search query example uses `semanticSearchOptions: { configurationName: 'default' }`. The actual SDK uses `queryType: 'semantic'` with `semanticSearchOptions` or `semanticConfiguration` depending on SDK version. Multiple small inconsistencies across Phase 2 and Phase 3 code.

**Fix:**  
Align all code samples with `@azure/search-documents` v12+ stable API:

```typescript
const results = await searchClient.search("query text", {
  vectorSearchOptions: {
    queries: [{
      kind: "vector",
      vector: embedding,
      kNearestNeighborsCount: 10,
      fields: ["content_vector"],
    }],
  },
  queryType: "semantic",
  semanticSearchOptions: { configurationName: "default" },
  top: 15,
});
```

---

## 🟠 MODERATE — Should fix

### 8. Gremlin Node.js client code is inaccurate

**The Problem:**  
Code references `new GremlinClient(...)` but the actual package is `gremlin` from Apache TinkerPop, and connecting to Cosmos DB requires specific WebSocket configuration and SASL authentication.

**Fix:**  
Use the correct client pattern:

```typescript
import Gremlin from "gremlin";
const authenticator = new Gremlin.driver.auth.PlainTextSaslAuthenticator(
  `/dbs/${database}/colls/${collection}`,
  primaryKey
);
const client = new Gremlin.driver.Client(endpoint, { authenticator, traversalsource: "g", mimeType: "application/vnd.gremlin-v2.0+json" });
```

---

### 9. Graph API subscription lifetimes differ by resource type

**The Problem:**  
All subscriptions use a 3-day expiration, but **chat message subscriptions** max out at **1 hour** (not 3 days). The doc acknowledges this in a comment but the code doesn't implement different renewal cadences.

**Fix:**  
Implement per-resource-type subscription configuration and a more frequent renewal timer for chat subscriptions (if/when Teams chat observation is added).

---

### 10. Azure OpenAI `GlobalStandard` SKU has regional availability constraints

**The Problem:**  
The Bicep uses `GlobalStandard` for GPT-4o deployment. This SKU is only available in certain regions and routes traffic globally, which may conflict with data residency requirements in enterprise/customer deployments.

**Fix:**  
- Default to `Standard` SKU for customer deployments (regional)
- Document that `GlobalStandard` trades data residency for higher availability
- Add region selection guidance for the customer

---

## ✅ What's solid

- **Overall architecture layering** (extraction → processing → storage → serving) is clean and well-reasoned
- **Azure AI Search hybrid search** approach (vector + keyword + semantic reranking) is the current best practice
- **Consent framework design** is thorough and enterprise-appropriate
- **Quality scoring and gap identification** for interview prioritization is well thought out
- **ADRs** capture genuine trade-offs
- **User journeys** are realistic and customer-presentable
- **Chunking strategies** per content type are well-calibrated
- **Error handling** patterns (retry with backoff, dead-letter queue) are production-ready

---

## Recommended Action Plan

1. **Fix Critical #1 first** — Split Cosmos DB into two accounts (or drop Gremlin for MVP and use document-based graph modeling)
2. **Fix Critical #2** — Replace all Bot Framework SDK v4 code with Teams SDK
3. **Fix Critical #3** — Remove `Chat.Read.All` from MVP scope, add RSC roadmap
4. **Fix Significant #4-5** — Update AI Foundry SDK references and Bicep templates
5. **Fix remaining** — Update API versions, SDK shapes, and client code
6. **Re-validate** — After fixes, do a line-by-line walk of the Bicep to ensure deployability
