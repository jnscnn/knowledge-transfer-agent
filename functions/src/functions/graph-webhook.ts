// HTTP trigger: receive and validate Graph API change notifications

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { getCosmosClient } from '../shared/config.js';
import type { GraphNotificationPayload, SubscriptionRecord } from '../shared/types.js';

app.http('graph-webhook', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'api/graph/webhook',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    // Handle Graph API validation handshake
    const validationToken = request.query.get('validationToken');
    if (validationToken) {
      context.log('Handling Graph webhook validation');
      return {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: validationToken,
      };
    }

    // Process change notifications
    try {
      const body = (await request.json()) as GraphNotificationPayload;

      if (!body.value || !Array.isArray(body.value)) {
        context.warn('Received webhook with no notifications');
        return { status: 202 };
      }

      context.log(`Received ${body.value.length} Graph notification(s)`);

      const { client: cosmosClient, databaseId } = getCosmosClient();
      const db = cosmosClient.database(databaseId);

      for (const notification of body.value) {
        // Validate clientState to ensure notification is authentic
        const subscriptionRecords = await db
          .container('observations')
          .items.query<SubscriptionRecord>({
            query:
              'SELECT * FROM c WHERE c.type = "subscription" AND c.subscriptionId = @subId',
            parameters: [{ name: '@subId', value: notification.subscriptionId }],
          })
          .fetchAll();

        const subRecord = subscriptionRecords.resources[0];
        if (subRecord && subRecord.clientState !== notification.clientState) {
          context.warn(
            `Invalid clientState for subscription ${notification.subscriptionId}`,
          );
          continue;
        }

        const retireeId = subRecord?.retireeId ?? 'unknown';

        // Enqueue the notification for processing
        const observationRecord = {
          id: `notif-${notification.subscriptionId}-${Date.now()}`,
          type: 'graph-notification',
          retireeId,
          subscriptionId: notification.subscriptionId,
          changeType: notification.changeType,
          resource: notification.resource,
          resourceId: notification.resourceData?.id ?? '',
          resourceType: notification.resourceData?.['@odata.type'] ?? '',
          tenantId: notification.tenantId,
          status: 'pending',
          receivedAt: new Date().toISOString(),
        };

        await db.container('observations').items.upsert(observationRecord);

        context.log('Notification queued', {
          subscriptionId: notification.subscriptionId,
          changeType: notification.changeType,
          resource: notification.resource,
          retireeId,
        });
      }

      return { status: 202 };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      context.error(`Failed to process Graph webhook: ${message}`);
      return { status: 500, body: 'Internal server error' };
    }
  },
});
