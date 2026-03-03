# ADR-001: Microsoft Stack for Knowledge Transfer Agent

## Status

**Accepted**

## Context

We need to choose a cloud platform and technology stack for building an AI agent that captures institutional knowledge from retiring employees. The agent needs deep integration with workplace tools (email, calendar, chat, documents) and access to enterprise AI services.

Options considered:

1. **Microsoft Stack** — M365 + Azure AI Foundry + Graph API
2. **AWS Stack** — WorkMail/WorkDocs + Bedrock + custom integrations
3. **Google Stack** — Workspace + Vertex AI + Workspace APIs
4. **Multi-cloud** — Best-of-breed components across providers

## Decision

We will use the **Microsoft stack** as the primary platform: Microsoft 365 for workplace data access, Azure AI Foundry for agent orchestration, Azure OpenAI for language models, and Microsoft Graph API as the connective tissue.

## Rationale

1. **Deepest workplace integration** — Microsoft Graph API provides unified access to emails, calendar, Teams messages, SharePoint, OneDrive, and organizational data. No other platform offers this depth of workplace data access through a single API.

2. **Enterprise ubiquity** — Most large enterprises already use Microsoft 365, meaning:
   - No new workplace tools to deploy
   - Users interact with the agent in tools they already use (Teams, Copilot)
   - Entra ID is already the identity provider
   - Compliance tools (Purview, Sentinel) are already licensed

3. **M365 Copilot extensibility** — The ability to surface knowledge contextually within Copilot (e.g., when editing a document the retiree authored) is a unique capability.

4. **Azure AI Foundry maturity** — Provides agent orchestration, tool-use, and multi-turn conversation management out of the box, reducing custom development.

5. **Security & compliance** — Entra ID, Purview, and Conditional Access provide enterprise-grade security that organizations' compliance teams already trust.

## Consequences

### Positive
- Fastest path to deep workplace integration
- Leverages existing enterprise investments
- Strong security and compliance story
- Rich ecosystem of connectors and extensions

### Negative
- **Vendor lock-in** — Deep dependency on Microsoft's ecosystem and pricing decisions
- **Cost** — Azure AI services (especially OpenAI) can be expensive at scale
- **Platform changes** — Microsoft frequently evolves APIs and services; maintenance burden
- **Non-M365 orgs** — Architecture doesn't translate to organizations using Google Workspace or other tools

### Mitigations
- Abstract the LLM layer behind an interface to allow model swapping
- Use standard protocols (OpenAI API format) where possible
- Document Graph API dependencies to facilitate future migration
- Design storage layer to be cloud-portable (standard schemas, exportable data)
