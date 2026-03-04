// Knowledge chunk quality scoring

import type { EntityMention, QualityScore } from '../shared/types.js';

const WEIGHTS = {
  completeness: 0.25,
  specificity: 0.25,
  uniqueness: 0.15,
  actionability: 0.20,
  recency: 0.15,
} as const;

// Max age in days for full recency score
const MAX_RECENCY_DAYS = 365;

export class QualityScorer {
  score(chunk: {
    content: string;
    entities: EntityMention[];
    source: { type: string; timestamp?: Date };
  }): QualityScore {
    const completeness = this.scoreCompleteness(chunk.content, chunk.entities);
    const specificity = this.scoreSpecificity(chunk.content);
    const uniqueness = this.scoreUniqueness(chunk.content, chunk.entities);
    const actionability = this.scoreActionability(chunk.content);
    const recency = this.scoreRecency(chunk.source.timestamp);

    const overall = clamp(
      completeness * WEIGHTS.completeness +
      specificity * WEIGHTS.specificity +
      uniqueness * WEIGHTS.uniqueness +
      actionability * WEIGHTS.actionability +
      recency * WEIGHTS.recency,
    );

    return { overall, completeness, specificity, uniqueness, actionability, recency };
  }

  private scoreCompleteness(content: string, entities: EntityMention[]): number {
    let score = 0;
    const lower = content.toLowerCase();

    // Has a subject? (entity mentions)
    if (entities.length > 0) score += 0.3;
    if (entities.length >= 3) score += 0.1;

    // Has action/verb indicators?
    const actionPatterns = [
      /\b(?:should|must|need to|has to|will|can|does|runs|manages|handles|processes)\b/i,
      /\b(?:when|if|then|because|since|after|before)\b/i,
    ];
    for (const pattern of actionPatterns) {
      if (pattern.test(content)) score += 0.15;
    }

    // Has context (location, time, condition)?
    const contextPatterns = [
      /\b(?:in|at|on|during|every|weekly|monthly|daily)\b/i,
      /\b(?:department|team|system|server|database|application)\b/i,
    ];
    for (const pattern of contextPatterns) {
      if (pattern.test(lower)) score += 0.1;
    }

    // Has reasonable length
    const wordCount = content.split(/\s+/).length;
    if (wordCount >= 50) score += 0.1;

    return clamp(score);
  }

  private scoreSpecificity(content: string): number {
    let score = 0;

    // Contains proper names (capitalized words not at sentence start)
    const properNamePattern = /(?<=[.!?]\s+|\n)[^A-Z]*[A-Z][a-z]+/g;
    const nameMatches = content.match(properNamePattern);
    if (nameMatches && nameMatches.length > 0) score += 0.2;

    // Contains dates
    const datePattern = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i;
    if (datePattern.test(content)) score += 0.2;

    // Contains numbers/quantities
    const numberPattern = /\b\d+(?:\.\d+)?(?:\s*(?:%|percent|times|hours|minutes|days|weeks|years|GB|MB|TB|ms|seconds))\b/i;
    if (numberPattern.test(content)) score += 0.15;

    // Contains specific steps or sequences
    const stepPattern = /\b(?:step\s+\d|first|second|third|then|next|finally)\b/i;
    if (stepPattern.test(content)) score += 0.2;

    // Contains version numbers, paths, URLs, emails
    const techPattern = /(?:v\d+\.\d+|[a-z]:\\|\/[a-z]+\/|https?:\/\/|@[a-z]+\.[a-z]+)/i;
    if (techPattern.test(content)) score += 0.15;

    // Penalize vague language
    const vaguePatterns = /\b(?:sometimes|maybe|probably|generally|usually|sort of|kind of|things|stuff)\b/i;
    if (vaguePatterns.test(content)) score -= 0.15;

    return clamp(score);
  }

  private scoreUniqueness(content: string, entities: EntityMention[]): number {
    // Heuristic: higher entity density suggests more unique/specialized knowledge
    const wordCount = content.split(/\s+/).length;
    const entityDensity = wordCount > 0 ? entities.length / wordCount : 0;

    let score = 0;

    // Entity density scoring
    if (entityDensity > 0.05) score += 0.4;
    else if (entityDensity > 0.02) score += 0.25;
    else if (entityDensity > 0.01) score += 0.15;

    // Diverse entity types increase uniqueness
    const uniqueTypes = new Set(entities.map((e) => e.type));
    if (uniqueTypes.size >= 4) score += 0.3;
    else if (uniqueTypes.size >= 2) score += 0.2;
    else if (uniqueTypes.size >= 1) score += 0.1;

    // Contains workarounds or decisions (rare, high-value knowledge)
    const hasWorkaround = entities.some((e) => e.type === 'Workaround');
    const hasDecision = entities.some((e) => e.type === 'Decision');
    if (hasWorkaround) score += 0.2;
    if (hasDecision) score += 0.15;

    return clamp(score);
  }

  private scoreActionability(content: string): number {
    let score = 0;

    // Contains procedural language
    const proceduralPatterns = [
      /\b(?:step\s+\d|to do this|follow these|instructions|procedure|how to)\b/i,
      /\b(?:click|navigate|open|run|execute|configure|set up|install)\b/i,
    ];
    for (const pattern of proceduralPatterns) {
      if (pattern.test(content)) score += 0.15;
    }

    // Contains contact information
    const contactPattern = /\b(?:contact|reach out|email|call|ask|talk to|escalate to)\b/i;
    if (contactPattern.test(content)) score += 0.15;

    // Contains decision criteria
    const decisionPattern = /\b(?:if.*then|when.*should|criteria|threshold|rule|policy)\b/i;
    if (decisionPattern.test(content)) score += 0.15;

    // Contains lists (numbered or bulleted)
    const listPattern = /(?:^|\n)\s*(?:\d+[.)]\s|-\s|\*\s|•)/m;
    if (listPattern.test(content)) score += 0.15;

    // Contains commands or code
    const codePattern = /`[^`]+`|```[\s\S]*?```/;
    if (codePattern.test(content)) score += 0.1;

    // Contains URLs or file paths
    const resourcePattern = /(?:https?:\/\/\S+|\\\\[^\s]+|[A-Z]:\\[^\s]+)/i;
    if (resourcePattern.test(content)) score += 0.1;

    return clamp(score);
  }

  private scoreRecency(timestamp?: Date): number {
    if (!timestamp) return 0.5; // Default if unknown

    const now = new Date();
    const ageMs = now.getTime() - timestamp.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays < 0) return 1.0; // Future date, treat as most recent
    if (ageDays > MAX_RECENCY_DAYS) return 0.1;

    // Exponential decay: score = e^(-ageDays / halfLife)
    const halfLife = MAX_RECENCY_DAYS / 3;
    return clamp(Math.exp(-ageDays / halfLife));
  }
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}
