// Microsoft Graph API client wrapper for the Passive Observer module

import { Client, type PageCollection } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { logger } from '../shared/logger.js';
import { GraphApiError } from '../shared/errors.js';
import { withRetry } from '../shared/retry.js';

// ── Interfaces ──

export interface GraphEmail {
  id: string;
  subject: string;
  from: string;
  toRecipients: string[];
  ccRecipients: string[];
  receivedDateTime: Date;
  conversationId: string;
  bodyPreview: string;
}

export interface GraphEvent {
  id: string;
  subject: string;
  organizer: string;
  attendees: string[];
  recurrence: unknown;
  start: Date;
  end: Date;
  isOnlineMeeting: boolean;
}

export interface GraphPerson {
  displayName: string;
  emailAddresses: string[];
  department: string;
  jobTitle: string;
}

export interface GraphFile {
  id: string;
  name: string;
  lastModifiedDateTime: Date;
  webUrl: string;
}

// ── Client ──

export class GraphApiClient {
  private client: Client;

  constructor(tenantId: string, clientId: string, clientSecret: string) {
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    });

    this.client = Client.initWithMiddleware({ authProvider });
  }

  // ── Email queries ──

  async getRecentEmails(userId: string, since: Date, top = 100): Promise<GraphEmail[]> {
    return this.withGraphRetry('getRecentEmails', async () => {
      const sinceIso = since.toISOString();
      const response: PageCollection = await this.client
        .api(`/users/${userId}/messages`)
        .filter(`receivedDateTime ge ${sinceIso}`)
        .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,conversationId,bodyPreview')
        .top(top)
        .orderby('receivedDateTime desc')
        .get();

      return (response.value as unknown[]).map((m) => this.mapEmail(m));
    });
  }

  async getEmailDelta(
    userId: string,
    deltaLink?: string,
  ): Promise<{ emails: GraphEmail[]; deltaLink: string }> {
    return this.withGraphRetry('getEmailDelta', async () => {
      const request = deltaLink
        ? this.client.api(deltaLink)
        : this.client
            .api(`/users/${userId}/messages/delta`)
            .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,conversationId,bodyPreview');

      const emails: GraphEmail[] = [];
      let page: PageCollection = await request.get();

      while (page.value) {
        for (const m of page.value as unknown[]) {
          emails.push(this.mapEmail(m));
        }
        if (page['@odata.nextLink']) {
          page = await this.client.api(page['@odata.nextLink'] as string).get();
        } else {
          break;
        }
      }

      const newDeltaLink = (page['@odata.deltaLink'] as string) ?? '';
      return { emails, deltaLink: newDeltaLink };
    });
  }

  // ── Calendar queries ──

  async getCalendarView(userId: string, start: Date, end: Date): Promise<GraphEvent[]> {
    return this.withGraphRetry('getCalendarView', async () => {
      const response: PageCollection = await this.client
        .api(`/users/${userId}/calendarView`)
        .query({ startDateTime: start.toISOString(), endDateTime: end.toISOString() })
        .select('id,subject,organizer,attendees,recurrence,start,end,isOnlineMeeting')
        .top(250)
        .get();

      return (response.value as unknown[]).map((e) => this.mapEvent(e));
    });
  }

  async getRecurringEvents(userId: string): Promise<GraphEvent[]> {
    return this.withGraphRetry('getRecurringEvents', async () => {
      const response: PageCollection = await this.client
        .api(`/users/${userId}/events`)
        .filter('recurrence ne null')
        .select('id,subject,organizer,attendees,recurrence,start,end,isOnlineMeeting')
        .top(100)
        .get();

      return (response.value as unknown[]).map((e) => this.mapEvent(e));
    });
  }

  // ── Relationship queries ──

  async getTopPeople(userId: string, top = 25): Promise<GraphPerson[]> {
    return this.withGraphRetry('getTopPeople', async () => {
      const response: PageCollection = await this.client
        .api(`/users/${userId}/people`)
        .select('displayName,emailAddresses,department,jobTitle')
        .top(top)
        .get();

      return (response.value as unknown[]).map((p) => this.mapPerson(p));
    });
  }

  async getDirectReports(userId: string): Promise<GraphPerson[]> {
    return this.withGraphRetry('getDirectReports', async () => {
      const response: PageCollection = await this.client
        .api(`/users/${userId}/directReports`)
        .select('displayName,mail,department,jobTitle')
        .get();

      return (response.value as unknown[]).map((p) => this.mapPerson(p));
    });
  }

  async getManager(userId: string): Promise<GraphPerson | null> {
    return this.withGraphRetry('getManager', async () => {
      try {
        const response: unknown = await this.client
          .api(`/users/${userId}/manager`)
          .select('displayName,mail,department,jobTitle')
          .get();

        return this.mapPerson(response);
      } catch (error: unknown) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404) return null;
        throw error;
      }
    });
  }

  // ── Document queries ──

  async getRecentFiles(userId: string): Promise<GraphFile[]> {
    return this.withGraphRetry('getRecentFiles', async () => {
      const response: PageCollection = await this.client
        .api(`/users/${userId}/drive/recent`)
        .select('id,name,lastModifiedDateTime,webUrl')
        .top(100)
        .get();

      return (response.value as unknown[]).map((f) => this.mapFile(f));
    });
  }

  async getSharedFiles(userId: string): Promise<GraphFile[]> {
    return this.withGraphRetry('getSharedFiles', async () => {
      const response: PageCollection = await this.client
        .api(`/users/${userId}/drive/sharedWithMe`)
        .select('id,name,lastModifiedDateTime,webUrl')
        .top(100)
        .get();

      return (response.value as unknown[]).map((f) => this.mapFile(f));
    });
  }

  // ── Internal helpers ──

  /** Expose the underlying client for subscription management */
  get rawClient(): Client {
    return this.client;
  }

  private async withGraphRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
        retryOn: (error: unknown) => {
          const status = (error as { statusCode?: number }).statusCode;
          return status === 429 || (status !== undefined && status >= 500);
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Graph API error in ${operation}`, {
        component: 'GraphApiClient',
        operation,
        error: error instanceof Error ? error : undefined,
      });
      throw new GraphApiError(message, { operation });
    }
  }

  private mapEmail(raw: unknown): GraphEmail {
    const m = raw as Record<string, unknown>;
    const from = m['from'] as Record<string, unknown> | undefined;
    const fromAddr = (from?.['emailAddress'] as Record<string, unknown>)?.['address'] as string ?? '';
    const toRecipients = this.extractRecipients(m['toRecipients']);
    const ccRecipients = this.extractRecipients(m['ccRecipients']);

    return {
      id: String(m['id'] ?? ''),
      subject: String(m['subject'] ?? ''),
      from: fromAddr,
      toRecipients,
      ccRecipients,
      receivedDateTime: new Date(String(m['receivedDateTime'] ?? '')),
      conversationId: String(m['conversationId'] ?? ''),
      bodyPreview: String(m['bodyPreview'] ?? ''),
    };
  }

  private extractRecipients(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((r: unknown) => {
      const addr = (r as Record<string, unknown>)['emailAddress'] as Record<string, unknown> | undefined;
      return String(addr?.['address'] ?? '');
    });
  }

  private mapEvent(raw: unknown): GraphEvent {
    const e = raw as Record<string, unknown>;
    const organizer = e['organizer'] as Record<string, unknown> | undefined;
    const organizerAddr = (organizer?.['emailAddress'] as Record<string, unknown>)?.['address'] as string ?? '';
    const attendees = Array.isArray(e['attendees'])
      ? e['attendees'].map((a: unknown) => {
          const addr = (a as Record<string, unknown>)['emailAddress'] as Record<string, unknown> | undefined;
          return String(addr?.['address'] ?? '');
        })
      : [];
    const start = e['start'] as Record<string, unknown> | undefined;
    const end = e['end'] as Record<string, unknown> | undefined;

    return {
      id: String(e['id'] ?? ''),
      subject: String(e['subject'] ?? ''),
      organizer: organizerAddr,
      attendees,
      recurrence: e['recurrence'] ?? null,
      start: new Date(String(start?.['dateTime'] ?? '')),
      end: new Date(String(end?.['dateTime'] ?? '')),
      isOnlineMeeting: Boolean(e['isOnlineMeeting']),
    };
  }

  private mapPerson(raw: unknown): GraphPerson {
    const p = raw as Record<string, unknown>;
    const emails = Array.isArray(p['emailAddresses'])
      ? p['emailAddresses'].map((e: unknown) => String((e as Record<string, unknown>)['address'] ?? ''))
      : p['mail'] ? [String(p['mail'])] : [];

    return {
      displayName: String(p['displayName'] ?? ''),
      emailAddresses: emails,
      department: String(p['department'] ?? ''),
      jobTitle: String(p['jobTitle'] ?? ''),
    };
  }

  private mapFile(raw: unknown): GraphFile {
    const f = raw as Record<string, unknown>;
    return {
      id: String(f['id'] ?? ''),
      name: String(f['name'] ?? ''),
      lastModifiedDateTime: new Date(String(f['lastModifiedDateTime'] ?? '')),
      webUrl: String(f['webUrl'] ?? ''),
    };
  }
}
