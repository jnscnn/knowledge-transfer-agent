// Analyze email patterns for the Passive Observer module

import { logger } from '../shared/logger.js';
import type { EmailAnalysis, DomainClassification } from '../shared/types.js';
import type { GraphApiClient, GraphEmail } from './graph-client.js';

export class EmailAnalyzer {
  private graphClient: GraphApiClient;

  constructor(graphClient: GraphApiClient) {
    this.graphClient = graphClient;
  }

  async analyzePatterns(retireeId: string, periodDays = 90): Promise<EmailAnalysis> {
    logger.info('Analyzing email patterns', {
      component: 'EmailAnalyzer',
      operation: 'analyzePatterns',
      retireeId,
      periodDays: String(periodDays),
    });

    const since = new Date();
    since.setDate(since.getDate() - periodDays);
    const now = new Date();

    const emails = await this.graphClient.getRecentEmails(retireeId, since, 500);

    const contactFrequency = this.computeContactFrequency(emails);
    const topicDistribution = this.computeTopicDistribution(emails);
    const uniqueContacts = this.findUniqueContacts(emails, retireeId);
    const threadPatterns = this.analyzeThreadPatterns(emails);
    const knowledgeDomains = this.suggestDomains(topicDistribution);

    const analysis: EmailAnalysis = {
      retireeId,
      period: { start: since, end: now },
      contactFrequency,
      topicDistribution,
      uniqueContacts,
      threadPatterns,
      knowledgeDomains,
    };

    logger.info('Email analysis complete', {
      component: 'EmailAnalyzer',
      retireeId,
      emailCount: String(emails.length),
      uniqueContactCount: String(uniqueContacts.length),
      topicCount: String(Object.keys(topicDistribution).length),
    });

    return analysis;
  }

  private computeContactFrequency(emails: GraphEmail[]): Record<string, number> {
    const freq: Record<string, number> = {};
    for (const email of emails) {
      const contacts = [email.from, ...email.toRecipients, ...email.ccRecipients];
      for (const contact of contacts) {
        if (contact) {
          freq[contact] = (freq[contact] ?? 0) + 1;
        }
      }
    }
    return freq;
  }

  private computeTopicDistribution(emails: GraphEmail[]): Record<string, number> {
    const topics: Record<string, number> = {};

    for (const email of emails) {
      const subject = email.subject.toLowerCase();
      // Strip common prefixes
      const cleaned = subject.replace(/^(re:|fw:|fwd:)\s*/gi, '').trim();
      if (!cleaned) continue;

      // Extract topic keywords by splitting on common separators
      const words = cleaned.split(/[\s\-_:,/]+/).filter((w) => w.length > 3);
      const topicKey = words.slice(0, 4).join(' ') || cleaned;
      topics[topicKey] = (topics[topicKey] ?? 0) + 1;
    }

    return topics;
  }

  private findUniqueContacts(emails: GraphEmail[], retireeId: string): string[] {
    // Contacts that ONLY communicate with this retiree (appear only in their mailbox)
    const contactsPerThread = new Map<string, Set<string>>();

    for (const email of emails) {
      const allContacts = [email.from, ...email.toRecipients, ...email.ccRecipients];
      for (const contact of allContacts) {
        if (!contact || contact === retireeId) continue;
        if (!contactsPerThread.has(contact)) {
          contactsPerThread.set(contact, new Set());
        }
        contactsPerThread.get(contact)!.add(email.conversationId);
      }
    }

    // Contacts that appear in very few conversations may be unique to this retiree
    const uniqueThreshold = 3;
    return Array.from(contactsPerThread.entries())
      .filter(([, threads]) => threads.size <= uniqueThreshold)
      .map(([contact]) => contact);
  }

  private analyzeThreadPatterns(emails: GraphEmail[]): { longRunning: string[]; recurring: string[] } {
    const threadCounts = new Map<string, number>();
    const threadSubjects = new Map<string, string>();
    const threadDates = new Map<string, Date[]>();

    for (const email of emails) {
      const convId = email.conversationId;
      threadCounts.set(convId, (threadCounts.get(convId) ?? 0) + 1);
      if (!threadSubjects.has(convId)) {
        threadSubjects.set(convId, email.subject);
      }
      if (!threadDates.has(convId)) {
        threadDates.set(convId, []);
      }
      threadDates.get(convId)!.push(email.receivedDateTime);
    }

    // Long-running: threads with 10+ messages
    const longRunning = Array.from(threadCounts.entries())
      .filter(([, count]) => count >= 10)
      .map(([convId]) => threadSubjects.get(convId) ?? convId);

    // Recurring: detect threads that appear regularly (simplified heuristic)
    const recurring = Array.from(threadDates.entries())
      .filter(([, dates]) => {
        if (dates.length < 3) return false;
        const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
        const intervals: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          intervals.push(sorted[i]!.getTime() - sorted[i - 1]!.getTime());
        }
        // Check if intervals are roughly consistent (within 50% variance)
        const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
        return avg > 0 && intervals.every((iv) => Math.abs(iv - avg) / avg < 0.5);
      })
      .map(([convId]) => threadSubjects.get(convId) ?? convId);

    return { longRunning, recurring };
  }

  private suggestDomains(topicDistribution: Record<string, number>): DomainClassification[] {
    // Group high-frequency topics into suggested domains
    const sorted = Object.entries(topicDistribution).sort((a, b) => b[1] - a[1]);
    const topTopics = sorted.slice(0, 10);

    return topTopics.map(([topic, count]) => ({
      domain: topic,
      confidence: Math.min(count / 50, 1),
      evidence: { emails: count, meetings: 0, documents: 0, teamsMessages: 0 },
      suggestedInterviewQuestions: [
        `Can you describe your involvement with "${topic}"?`,
        `Who else should know about "${topic}" when you leave?`,
      ],
      gapIndicators: [],
    }));
  }
}
