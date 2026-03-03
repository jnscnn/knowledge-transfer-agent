# Microsoft Graph API Queries

## Overview

This document specifies the Graph API queries used by the Knowledge Transfer Agent for passive observation and relationship mapping.

## Required Permissions

### Application Permissions (Data Pipeline)

| Permission | Scope | Purpose |
|-----------|-------|---------|
| `Mail.Read` | Application | Read retiree's emails for pattern analysis |
| `Calendars.Read` | Application | Read retiree's calendar for meeting patterns |
| `Sites.Read.All` | Application | Read SharePoint content for document analysis |
| `Files.Read.All` | Application | Read OneDrive files for document analysis |
| `People.Read.All` | Application | Relationship mapping |
| `User.Read.All` | Application | Organizational context |

### Delegated Permissions (Bot/UI)

| Permission | Scope | Purpose |
|-----------|-------|---------|
| `User.Read` | Delegated | Basic user profile |
| `Chat.ReadWrite` | Delegated | Send/receive bot messages |

> ⚠️ **Teams Chat observation (`Chat.Read.All`) is excluded from MVP scope.**
> It is a **protected API** requiring formal Microsoft approval (can take weeks) and grants
> **tenant-wide** chat access — most enterprise IT admins will resist this.
> **For future phases:** Use **Resource-Specific Consent (RSC)** instead, which allows scoped
> permission per chat/team without tenant-wide access.

## Key Queries

### Email Analysis

```http
# Get recent emails (with pagination)
GET /users/{retiree-id}/messages
  ?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,conversationId,bodyPreview
  &$filter=receivedDateTime ge {start-date}
  &$orderby=receivedDateTime desc
  &$top=50

# Get email frequency by sender (aggregation done in code)
GET /users/{retiree-id}/messages
  ?$select=from,receivedDateTime
  &$filter=receivedDateTime ge {30-days-ago}
  &$top=999
```

### Calendar Analysis

```http
# Get meetings in date range
GET /users/{retiree-id}/calendarView
  ?startDateTime={start}&endDateTime={end}
  &$select=id,subject,organizer,attendees,recurrence,start,end,isOnlineMeeting

# Get recurring meetings (indicates routine responsibilities)
GET /users/{retiree-id}/events
  ?$filter=recurrence ne null
  &$select=id,subject,recurrence,organizer,attendees
```

### Relationship Mapping

```http
# Get people the retiree works with most
GET /users/{retiree-id}/people
  ?$top=50
  &$select=displayName,emailAddresses,department,jobTitle,scoredEmailAddresses

# Get org chart (direct reports, manager)
GET /users/{retiree-id}/directReports
  ?$select=id,displayName,jobTitle,department

GET /users/{retiree-id}/manager
  ?$select=id,displayName,jobTitle,department
```

### Document Activity

```http
# Get recently modified files
GET /users/{retiree-id}/drive/recent
  ?$select=id,name,lastModifiedDateTime,webUrl,createdBy,lastModifiedBy,parentReference

# Get files shared with the retiree
GET /users/{retiree-id}/drive/sharedWithMe
  ?$select=id,name,webUrl,remoteItem
```

### Teams Activity

> **Excluded from MVP.** Teams chat observation requires `Chat.Read.All` (protected API).
> Future phases will use RSC for scoped access. See permissions section above.

<!--
```http
# Get chats the retiree participates in (requires Chat.Read.All — protected API)
GET /users/{retiree-id}/chats
  ?$select=id,topic,chatType,lastUpdatedDateTime,members
  &$expand=members($select=displayName,email)
  &$top=50

# Get messages in a specific chat
GET /users/{retiree-id}/chats/{chat-id}/messages
  ?$select=id,body,from,createdDateTime
  &$top=50
```
-->

## Change Notification Subscriptions

```typescript
// Subscription setup for real-time observation
const subscriptions = [
  {
    changeType: 'created',
    notificationUrl: `${functionAppUrl}/api/graph-webhook`,
    resource: `/users/${retireeId}/messages`,
    expirationDateTime: addDays(new Date(), 3).toISOString(),
    clientState: `kt-email-${retireeId}`,
  },
  {
    changeType: 'created,updated',
    notificationUrl: `${functionAppUrl}/api/graph-webhook`,
    resource: `/users/${retireeId}/events`,
    expirationDateTime: addDays(new Date(), 3).toISOString(),
    clientState: `kt-calendar-${retireeId}`,
  },
];

// Subscription renewal (must renew before expiration)
// Max lifetime varies by resource type:
//   - Messages (mail): 3 days
//   - Calendar events:  3 days
//   - Drive (files):    3 days
//   - Chat messages:    1 HOUR (if added in future phases)
// Implement a timer-trigger Azure Function to renew all subscriptions
```

## Throttling & Rate Limits

| Resource | Limit | Strategy |
|----------|-------|----------|
| **Per-app** | 2000 req/sec | Unlikely to hit for single-retiree observation |
| **Per-mailbox** | 10,000 req/10 min | Use delta queries + batch requests |
| **Subscription** | 1000 active per app | Well within limits (< 10 per retiree) |

### Throttling Handling

```typescript
import { RetryOptions } from './retry.js';

const graphRetryOptions: RetryOptions = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  jitter: true,
  retryOn: (error) => {
    const status = error.statusCode;
    // Retry on throttling (429) and server errors (5xx)
    return status === 429 || (status >= 500 && status < 600);
  },
  getRetryDelay: (error, attempt) => {
    // Respect Retry-After header from Graph API
    const retryAfter = error.headers?.['retry-after'];
    if (retryAfter) return parseInt(retryAfter, 10) * 1000;
    // Otherwise, exponential backoff with jitter
    return Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 60000);
  },
};
```

## Delta Queries for Efficient Sync

```typescript
// Initial sync: get all emails
let deltaLink: string | undefined;

async function syncEmails(retireeId: string): Promise<void> {
  const url = deltaLink
    ? deltaLink  // Subsequent sync: only changed items
    : `/users/${retireeId}/messages/delta?$select=id,subject,from,receivedDateTime`;

  const response = await graphClient.api(url).get();

  // Process changed/new emails
  for (const message of response.value) {
    await processEmailObservation(message);
  }

  // Store delta link for next sync
  deltaLink = response['@odata.deltaLink'];
}
```
