/**
 * HyDE (Hypothetical Document Embedding) prompt template.
 *
 * Generates a prompt that asks GPT-4o to write a hypothetical paragraph
 * that would appear in the knowledge base as the ideal answer.
 */

export function getHydePrompt(question: string): string {
  return `You are a retiring employee sharing your deep institutional knowledge. Given the following question, write a hypothetical 2–3 sentence paragraph that would be the perfect answer found in the knowledge base.

Rules:
- Write as if you ARE the knowledgeable employee explaining something to your successor.
- Include concrete details: specific system names, people, process steps, dates, or decisions.
- Do NOT hedge or qualify — state things directly and confidently.
- Do NOT use phrases like "I think" or "possibly" — write as established fact.
- Keep it to 2–3 sentences maximum.

Question: ${question}

Hypothetical knowledge base paragraph:`;
}
