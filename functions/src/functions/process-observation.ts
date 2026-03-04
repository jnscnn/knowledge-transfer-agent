// Process Graph change notifications: read the changed resource and feed through pipeline

import { app, type InvocationContext, type Timer } from '@azure/functions';
import { getCosmosClient, getGraphClient } from '../shared/config.js';

interface PendingNotification {
  id: string;
  type: string;
  retireeId: string;
  subscriptionId: string;
  changeType: string;
  resource: string;
  resourceId: string;
  resourceType: string;
  status: string;
  receivedAt: string;
}

app.timer('process-observation', {
  schedule: '0 */5 * * * *', // Every 5 minutes
  handler: async (_timer: Timer, context: InvocationContext) => {
    context.log('Processing pending Graph notifications');

    const { client: cosmosClient, databaseId } = getCosmosClient();
    const db = cosmosClient.database(databaseId);

    // Find pending notifications
    const pendingResult = await db
      .container('observations')
      .items.query<PendingNotification>({
        query:
          'SELECT * FROM c WHERE c.type = "graph-notification" AND c.status = "pending" ORDER BY c.receivedAt ASC OFFSET 0 LIMIT 50',
      })
      .fetchAll();

    const pending = pendingResult.resources;
    if (pending.length === 0) {
      context.log('No pending notifications to process');
      return;
    }

    context.log(`Found ${pending.length} pending notification(s)`);

    const graphClient = getGraphClient();
    let processed = 0;
    let failed = 0;

    for (const notification of pending) {
      try {
        // Mark as processing
        await db.container('observations').items.upsert({
          ...notification,
          status: 'processing',
          processingStartedAt: new Date().toISOString(),
        });

        // Read the changed resource from Graph API
        let resourceData: unknown = null;
        try {
          resourceData = await graphClient.api(notification.resource).get();
        } catch (graphError: unknown) {
          const status = (graphError as { statusCode?: number }).statusCode;
          if (status === 404) {
            context.log(`Resource no longer exists: ${notification.resource}`);
            await db.container('observations').items.upsert({
              ...notification,
              status: 'skipped',
              reason: 'resource_not_found',
              processedAt: new Date().toISOString(),
            });
            processed++;
            continue;
          }
          throw graphError;
        }

        // Store the observation data
        const observationData = {
          id: `obs-${notification.id}`,
          type: 'observation-data',
          retireeId: notification.retireeId,
          sourceNotificationId: notification.id,
          changeType: notification.changeType,
          resourceType: notification.resourceType,
          resourceId: notification.resourceId,
          data: resourceData,
          capturedAt: new Date().toISOString(),
        };

        await db.container('observations').items.upsert(observationData);

        // Mark notification as completed
        await db.container('observations').items.upsert({
          ...notification,
          status: 'completed',
          processedAt: new Date().toISOString(),
        });

        processed++;
      } catch (error: unknown) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        context.error(
          `Failed to process notification ${notification.id}: ${message}`,
        );

        // Mark as failed for retry
        await db.container('observations').items.upsert({
          ...notification,
          status: 'failed',
          error: message,
          failedAt: new Date().toISOString(),
        });
      }
    }

    context.log(`Observation processing complete: ${processed} succeeded, ${failed} failed`);
  },
});
