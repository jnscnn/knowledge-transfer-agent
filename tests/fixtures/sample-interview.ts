// Sample interview fixtures for testing

import type { EntityMention, RetireeProfile } from '../../src/shared/types.js';

export const sampleInterviewTranscript = `Q: Can you walk me through the vendor management process for our key suppliers?

A: Sure. The main thing to understand is that we work with three critical vendors: Acme Corp for our raw materials, TechStar Solutions for our cloud infrastructure, and DataFlow Inc for our analytics platform. Each vendor has a different renewal cycle and escalation path.

Q: Let's start with Acme Corp. What does that relationship look like?

A: Acme Corp has been our supplier since 2018. The contract renews every two years, and the next renewal is in March 2025. The primary contact there is Sarah Chen, who is their account executive. If there are quality issues, you escalate to their VP of Operations, Mark Rodriguez. We have a standing monthly call on the first Tuesday to review metrics.

Q: What about the pricing negotiations? Any tricks to know?

A: The key thing with Acme is that their list prices are always 15-20% higher than what we actually pay. When renewal comes up, you should start negotiations at least 90 days before expiration. Pull the usage reports from the Procurement Dashboard — that's in SharePoint under /sites/procurement/reports. The historical pricing data is critical leverage. Also, talk to Janet Williams in Finance before you start — she tracks the total spend across departments.

Q: What happens if there's a supply chain disruption with Acme?

A: We have a backup supplier agreement with GlobalParts Ltd, but it's never been activated. The agreement is documented in the BCP folder on SharePoint. The workaround we've used twice is to pre-order 6 months of inventory when we see disruption signals. The signals to watch are: their quarterly earnings calls, shipping delays over 5 days from their Shenzhen facility, and any news about tariff changes. I set up a monitoring process in Power Automate that checks these indicators weekly.

Q: That's very helpful. Now tell me about the TechStar Solutions relationship.

A: TechStar manages our Azure environment and provides level-2 support. Our agreement is an Enterprise Agreement renewed annually in September. The technical contact is Priya Patel, and for billing issues, contact their finance team at billing@techstar.com. The critical thing to know is that we negotiated a 30% discount on compute costs in 2023 — make sure that carries forward. The contract details are in Dynamics 365 under account ID TS-2019-0042.`;

export const expectedEntities: Array<{ text: string; type: EntityMention['type'] }> = [
  { text: 'Acme Corp', type: 'Vendor' },
  { text: 'TechStar Solutions', type: 'Vendor' },
  { text: 'DataFlow Inc', type: 'Vendor' },
  { text: 'Sarah Chen', type: 'Person' },
  { text: 'Mark Rodriguez', type: 'Person' },
  { text: 'Janet Williams', type: 'Person' },
  { text: 'Priya Patel', type: 'Person' },
  { text: 'GlobalParts Ltd', type: 'Vendor' },
  { text: 'Procurement Dashboard', type: 'System' },
  { text: 'Power Automate', type: 'System' },
  { text: 'Dynamics 365', type: 'System' },
  { text: 'vendor management', type: 'Process' },
];

export const expectedChunkTopics = [
  'vendor overview and key suppliers',
  'Acme Corp relationship and contacts',
  'pricing negotiation strategy',
  'supply chain disruption workaround',
  'TechStar Solutions relationship',
];

export const sampleRetireeProfile: RetireeProfile = {
  id: 'retiree-001',
  entraId: 'entra-abc-123',
  name: 'Robert Thompson',
  email: 'robert.thompson@contoso.com',
  department: 'Procurement',
  team: 'Vendor Management',
  role: 'Senior Procurement Manager',
  retirementDate: new Date('2025-06-30'),
  ktStartDate: new Date('2025-01-15'),
  status: 'active',
  knowledgeDomains: ['vendor-management', 'supply-chain', 'contract-negotiation'],
  overallCoverage: 0.35,
  consentId: 'consent-001',
  managerId: 'manager-001',
  successorIds: ['successor-001'],
};
