/**
 * Query rewriting prompt template for multi-retrieval optimization.
 */

export function getQueryRewritePrompt(userQuestion: string): string {
  return `You are a query rewriting engine for a knowledge base of institutional knowledge captured from retiring employees. Given the user's question, generate an optimized retrieval plan.

Analyze the following question and produce a JSON object with these fields:

1. **vectorQuery**: A rephrased version of the question optimized for semantic similarity search. Be specific; expand abbreviations; include synonyms.
2. **keywordQuery**: Extract the most important key terms for BM25 keyword search. Use space-separated terms, no stop words.
3. **graphConcept**: An object describing how to query the knowledge graph:
   - **entities**: Array of entity names or types to look up (people, systems, processes, etc.)
   - **relationshipTypes**: Array of relevant relationship types (owns, uses, contacts, decided, depends_on, has_workaround, escalates_to, documents, belongs_to, succeeded_by, rationale_for)
   - **queryPattern**: A short natural-language description of the graph traversal needed
4. **intent**: One of: factual | relational | procedural | decision_context | exploratory | meta
   - factual: "What is X?", "Who does Y?"
   - relational: "Who does X work with?", "What depends on Y?"
   - procedural: "How do I do X?", "What are the steps for Y?"
   - decision_context: "Why was X decided?", "What was the rationale for Y?"
   - exploratory: "Tell me about X", "What do we know about Y?"
   - meta: Questions about the knowledge base itself, coverage, gaps

Return ONLY valid JSON, no markdown fences, no extra text.

Example output:
{
  "vectorQuery": "process for handling vendor escalations in the billing department",
  "keywordQuery": "vendor escalation billing process steps",
  "graphConcept": {
    "entities": ["billing department", "vendor escalation"],
    "relationshipTypes": ["escalates_to", "owns", "uses"],
    "queryPattern": "Find the billing department entity and traverse escalation relationships"
  },
  "intent": "procedural"
}

User question: ${userQuestion}`;
}
