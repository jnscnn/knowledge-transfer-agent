// ──────────────────────────────────────────────
// Core domain types for Knowledge Transfer Agent
// ──────────────────────────────────────────────

// ── Retiree ──

export interface RetireeProfile {
  id: string;
  entraId: string;
  name: string;
  email: string;
  department: string;
  team: string;
  role: string;
  retirementDate: Date;
  ktStartDate: Date;
  status: 'active' | 'paused' | 'completed';
  knowledgeDomains: string[];
  overallCoverage: number;
  consentId: string;
  managerId: string;
  successorIds: string[];
}

// ── Interview ──

export interface InterviewSession {
  id: string;
  retireeId: string;
  sessionNumber: number;
  startedAt: Date;
  endedAt?: Date;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  focusDomains: string[];
  questionsAsked: InterviewQuestion[];
  knowledgeChunksProduced: string[];
  coverageBefore: number;
  coverageAfter?: number;
}

export interface InterviewQuestion {
  id: string;
  text: string;
  generationLayer: 'template' | 'observation' | 'adaptive';
  domain: string;
  response?: string;
  followUps: InterviewQuestion[];
  entitiesMentioned: EntityMention[];
  completeness: 'complete' | 'needs_follow_up';
}

// ── Knowledge ──

export interface KnowledgeChunk {
  id: string;
  content: string;
  summary: string;
  knowledgeType: 'tacit' | 'explicit' | 'relational';
  domainId: string;
  retireeId: string;
  source: KnowledgeSource;
  entities: EntityMention[];
  qualityScore: QualityScore;
  sensitivityLevel: 'public' | 'internal' | 'confidential' | 'highly_confidential';
  consentId: string;
  vectors?: VectorIds;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeSource {
  type: 'interview' | 'observation' | 'document';
  sourceId: string;
  timestamp: Date;
}

export interface EntityMention {
  entityId: string;
  text: string;
  type: EntityType;
  confidence: number;
}

export type EntityType =
  | 'Person'
  | 'Organization'
  | 'System'
  | 'Process'
  | 'Decision'
  | 'Workaround'
  | 'Document'
  | 'Vendor';

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  description: string;
  properties: Record<string, unknown>;
  mentionCount: number;
  domains: string[];
  firstSeen: Date;
  lastSeen: Date;
}

export interface EntityRelationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: RelationshipType;
  properties: Record<string, unknown>;
  evidence: Array<{ chunkId: string; confidence: number }>;
  firstObserved: Date;
  lastObserved: Date;
}

export type RelationshipType =
  | 'owns'
  | 'uses'
  | 'contacts'
  | 'decided'
  | 'depends_on'
  | 'has_workaround'
  | 'escalates_to'
  | 'documents'
  | 'belongs_to'
  | 'succeeded_by'
  | 'rationale_for';

export interface QualityScore {
  overall: number;
  completeness: number;
  specificity: number;
  uniqueness: number;
  actionability: number;
  recency: number;
}

export interface VectorIds {
  contentVectorId: string;
  summaryVectorId: string;
  hydeVectorId?: string;
}

// ── Knowledge Domain ──

export interface KnowledgeDomain {
  id: string;
  retireeId: string;
  name: string;
  description: string;
  parentDomain?: string;
  criticality: 'low' | 'medium' | 'high' | 'critical';
  coverage: { captured: number; validated: number; gapsIdentified: number };
  sources: { interviews: number; observations: number; documents: number };
  suggestedSuccessor?: string;
  tags: string[];
}

// ── Query ──

export interface QueryIntent {
  type: 'factual' | 'relational' | 'procedural' | 'decision_context' | 'exploratory' | 'meta';
  entities: string[];
  domains: string[];
  timeScope?: { start: Date; end: Date };
  retireeScope?: string[];
}

export interface RewrittenQuery {
  vectorQuery: string;
  keywordQuery: string;
  graphQuery?: string;
  filters: SearchFilters;
}

export interface SearchFilters {
  domains?: string[];
  retireeIds?: string[];
  sourceTypes?: Array<'interview' | 'observation' | 'document'>;
  sensitivityLevels?: string[];
  minQualityScore?: number;
}

export interface AgentResponse {
  queryId: string;
  answer: string;
  confidence: number;
  sources: Citation[];
  coverage: 'complete' | 'partial' | 'insufficient';
  followUps: string[];
  processingTimeMs: number;
}

export interface Citation {
  type: 'interview' | 'email' | 'document' | 'observation';
  sourceId: string;
  title: string;
  url?: string;
  relevance: number;
  timestamp: Date;
  retiree: string;
}

// ── Observation ──

export interface EmailAnalysis {
  retireeId: string;
  period: { start: Date; end: Date };
  contactFrequency: Record<string, number>;
  topicDistribution: Record<string, number>;
  uniqueContacts: string[];
  threadPatterns: { longRunning: string[]; recurring: string[] };
  knowledgeDomains: DomainClassification[];
}

export interface DomainClassification {
  domain: string;
  parentDomain?: string;
  confidence: number;
  evidence: { emails: number; meetings: number; documents: number; teamsMessages: number };
  suggestedInterviewQuestions: string[];
  gapIndicators: string[];
}

// ── Feedback ──

export interface QueryFeedback {
  id: string;
  queryId: string;
  userId: string;
  value: 'positive' | 'negative';
  comment?: string;
  timestamp: Date;
  queryText: string;
  retrievedChunkIds: string[];
  confidence: number;
}

// ── Consent ──

export interface ConsentDocument {
  id: string;
  retireeId: string;
  grantedAt: Date;
  grantedBy: string;
  scope: ConsentScope;
  expiresAt?: Date;
  revoked: boolean;
  revokedAt?: Date;
}

export interface ConsentScope {
  emailObservation: boolean;
  calendarObservation: boolean;
  documentObservation: boolean;
  interviewCapture: boolean;
  knowledgeSharing: boolean;
  sensitivityLevelAllowed: string;
}
