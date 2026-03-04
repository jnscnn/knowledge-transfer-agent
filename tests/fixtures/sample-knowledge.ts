// Sample knowledge base fixtures for testing

import type {
  KnowledgeChunk,
  Entity,
  EntityRelationship,
  EntityMention,
  QualityScore,
  AgentResponse,
  Citation,
} from '../../src/shared/types.js';

function makeQualityScore(overall: number): QualityScore {
  return {
    overall,
    completeness: overall * 0.9,
    specificity: overall * 1.1 > 1 ? 1 : overall * 1.1,
    uniqueness: overall * 0.8,
    actionability: overall * 0.85,
    recency: 0.7,
  };
}

function makeChunk(
  id: string,
  content: string,
  domain: string,
  sourceType: 'interview' | 'observation' | 'document',
  sensitivity: 'public' | 'internal' | 'confidential' | 'highly_confidential',
  entities: EntityMention[],
  quality: number,
): KnowledgeChunk {
  const now = new Date('2025-03-01');
  return {
    id,
    content,
    summary: content.slice(0, 150),
    knowledgeType: 'tacit',
    domainId: domain,
    retireeId: 'retiree-001',
    source: { type: sourceType, sourceId: `session-${id}`, timestamp: now },
    entities,
    qualityScore: makeQualityScore(quality),
    sensitivityLevel: sensitivity,
    consentId: 'consent-001',
    createdAt: now,
    updatedAt: now,
  };
}

export const sampleChunks: KnowledgeChunk[] = [
  makeChunk(
    'chunk-001',
    'Acme Corp has been our primary raw materials supplier since 2018. The contract renews every two years in March. Contact Sarah Chen (account exec) for routine matters and Mark Rodriguez (VP Operations) for quality escalations.',
    'vendor-management',
    'interview',
    'internal',
    [
      { entityId: 'e1', text: 'Acme Corp', type: 'Vendor', confidence: 0.95 },
      { entityId: 'e2', text: 'Sarah Chen', type: 'Person', confidence: 0.9 },
      { entityId: 'e3', text: 'Mark Rodriguez', type: 'Person', confidence: 0.9 },
    ],
    0.85,
  ),
  makeChunk(
    'chunk-002',
    'When negotiating with Acme Corp, start at least 90 days before contract expiration. Pull usage reports from the Procurement Dashboard in SharePoint. Their list prices are typically 15-20% above negotiated rates. Coordinate with Janet Williams in Finance for total spend data.',
    'contract-negotiation',
    'interview',
    'confidential',
    [
      { entityId: 'e1', text: 'Acme Corp', type: 'Vendor', confidence: 0.95 },
      { entityId: 'e4', text: 'Janet Williams', type: 'Person', confidence: 0.88 },
      { entityId: 'e5', text: 'Procurement Dashboard', type: 'System', confidence: 0.92 },
    ],
    0.92,
  ),
  makeChunk(
    'chunk-003',
    'The quarterly budget review process involves collecting department forecasts by the 15th of the quarter-end month. The spreadsheet template is on SharePoint at /sites/finance/templates/quarterly-review.xlsx. Submit consolidated numbers to CFO office via the Budget Portal.',
    'budget-process',
    'document',
    'internal',
    [
      { entityId: 'e6', text: 'Budget Portal', type: 'System', confidence: 0.85 },
      { entityId: 'e7', text: 'CFO office', type: 'Organization', confidence: 0.8 },
    ],
    0.78,
  ),
  makeChunk(
    'chunk-004',
    'The TechStar Solutions Azure environment requires level-2 support tickets to be filed through their portal at support.techstar.com. Our Enterprise Agreement (account ID TS-2019-0042) includes a 30% discount on compute costs negotiated in 2023. Contact Priya Patel for technical issues.',
    'cloud-infrastructure',
    'interview',
    'confidential',
    [
      { entityId: 'e8', text: 'TechStar Solutions', type: 'Vendor', confidence: 0.93 },
      { entityId: 'e9', text: 'Priya Patel', type: 'Person', confidence: 0.91 },
    ],
    0.88,
  ),
  makeChunk(
    'chunk-005',
    'For supply chain disruptions with Acme Corp, we have a backup agreement with GlobalParts Ltd (documented in BCP folder on SharePoint). The workaround is to pre-order 6 months of inventory. Monitor signals: Acme quarterly earnings, shipping delays over 5 days from Shenzhen, tariff news.',
    'supply-chain',
    'interview',
    'internal',
    [
      { entityId: 'e1', text: 'Acme Corp', type: 'Vendor', confidence: 0.95 },
      { entityId: 'e10', text: 'GlobalParts Ltd', type: 'Vendor', confidence: 0.87 },
      { entityId: 'e11', text: 'pre-order inventory', type: 'Workaround', confidence: 0.82 },
    ],
    0.91,
  ),
  makeChunk(
    'chunk-006',
    'The DataFlow analytics platform dashboard needs daily monitoring. If data ingestion falls behind by more than 2 hours, restart the ETL pipeline via the admin console. The runbook is in the IT wiki under /runbooks/dataflow-recovery.',
    'analytics-ops',
    'observation',
    'internal',
    [
      { entityId: 'e12', text: 'DataFlow', type: 'System', confidence: 0.9 },
      { entityId: 'e13', text: 'ETL pipeline', type: 'Process', confidence: 0.85 },
    ],
    0.80,
  ),
  makeChunk(
    'chunk-007',
    'Sometimes things happen and stuff needs to be handled. Generally people should probably talk to someone about it.',
    'general',
    'interview',
    'public',
    [],
    0.15,
  ),
  makeChunk(
    'chunk-008',
    'The password for the legacy FTP server is admin123 and the root SSH key is stored at /home/deploy/.ssh/id_rsa. The database connection string includes the production credentials.',
    'legacy-systems',
    'document',
    'highly_confidential',
    [
      { entityId: 'e14', text: 'FTP server', type: 'System', confidence: 0.95 },
    ],
    0.6,
  ),
];

export const sampleEntities: Entity[] = [
  {
    id: 'e1',
    type: 'Vendor',
    name: 'Acme Corp',
    aliases: ['Acme', 'Acme Corporation'],
    description: 'Primary raw materials supplier',
    properties: { contractCycle: '2 years', region: 'Global' },
    mentionCount: 12,
    domains: ['vendor-management', 'supply-chain'],
    firstSeen: new Date('2025-01-20'),
    lastSeen: new Date('2025-03-01'),
  },
  {
    id: 'e2',
    type: 'Person',
    name: 'Sarah Chen',
    aliases: ['S. Chen'],
    description: 'Acme Corp account executive',
    properties: { role: 'Account Executive', company: 'Acme Corp' },
    mentionCount: 5,
    domains: ['vendor-management'],
    firstSeen: new Date('2025-01-20'),
    lastSeen: new Date('2025-02-28'),
  },
  {
    id: 'e8',
    type: 'Vendor',
    name: 'TechStar Solutions',
    aliases: ['TechStar'],
    description: 'Cloud infrastructure and Azure support provider',
    properties: { accountId: 'TS-2019-0042' },
    mentionCount: 8,
    domains: ['cloud-infrastructure'],
    firstSeen: new Date('2025-01-22'),
    lastSeen: new Date('2025-03-01'),
  },
];

export const sampleRelationships: EntityRelationship[] = [
  {
    id: 'rel-001',
    sourceEntityId: 'e2',
    targetEntityId: 'e1',
    relationshipType: 'contacts',
    properties: { role: 'primary contact' },
    evidence: [{ chunkId: 'chunk-001', confidence: 0.9 }],
    firstObserved: new Date('2025-01-20'),
    lastObserved: new Date('2025-03-01'),
  },
  {
    id: 'rel-002',
    sourceEntityId: 'e1',
    targetEntityId: 'e10',
    relationshipType: 'depends_on',
    properties: { type: 'backup supplier' },
    evidence: [{ chunkId: 'chunk-005', confidence: 0.85 }],
    firstObserved: new Date('2025-02-10'),
    lastObserved: new Date('2025-03-01'),
  },
];

export const sampleQuery = {
  question: 'Who should I contact at Acme Corp for quality issues?',
  expectedAnswer: 'Mark Rodriguez',
  expectedSources: ['chunk-001'],
  expectedEntities: ['Acme Corp', 'Mark Rodriguez'],
};

export const sampleAgentResponse: AgentResponse = {
  queryId: 'query-test-001',
  answer: 'For quality issues with Acme Corp, you should escalate to Mark Rodriguez, who is their VP of Operations. For routine matters, contact Sarah Chen, their account executive.',
  confidence: 0.85,
  sources: [
    {
      type: 'interview',
      sourceId: 'chunk-001',
      title: 'Vendor Management - Acme Corp Overview',
      relevance: 0.92,
      timestamp: new Date('2025-03-01'),
      retiree: 'Robert Thompson',
    },
  ] satisfies Citation[],
  coverage: 'complete',
  followUps: [
    'What is the escalation process for billing issues with Acme Corp?',
    'When does the Acme Corp contract renewal happen?',
  ],
  processingTimeMs: 1250,
};
