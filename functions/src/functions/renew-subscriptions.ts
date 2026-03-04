// Timer trigger: renew Graph API subscriptions daily before expiry

import { app, type InvocationContext, type Timer } from '@azure/functions';
import { getCosmosClient, getGraphClient } from '../shared/config.js';
import type { SubscriptionRecord } from '../shared/types.js';

// Max subscription lifetime: ~70 hours (3 days minus buffer)
const RENEWAL_HOURS = 70;

app.timer('renew-subscriptions', {
  schedule: '0 0 6 * * *', // Daily at 06:00 UTC
  handler: async (_timer: Timer, context: InvocationContext) => {
    context.log('Starting Graph subscription renewal');

    const { client: cosmosClient, databaseId } = getCosmosClient();
    const db = cosmosClient.database(databaseId);
    const graphClient = getGraphClient();

    // Find subscriptions expiring within the next 24 hours
    const threshold = new Date();
    threshold.setHours(threshold.getHours() + 24);

    const result = await db
      .container('observations')
      .items.query<SubscriptionRecord>({
        query:
          'SELECT * FROM c WHERE c.type = "subscription" AND c.expirationDateTime < @threshold',
        parameters: [{ name: '@threshold', value: threshold.toISOString() }],
      })
      .fetchAll();

    const subscriptions = result.resources;

    if (subscriptions.length === 0) {
      context.log('No subscriptions need renewal');
      return;
    }

    context.log(`Found ${subscriptions.length} subscription(s) to renew`);

    const newExpiration = new Date();
    newExpiration.setHours(newExpiration.getHours() + RENEWAL_HOURS);

    let renewed = 0;
    let failed = 0;
    let deleted = 0;

    for (const sub of subscriptions) {
      try {
        await graphClient
          .api(`/subscriptions/${sub.subscriptionId}`)
          .patch({ expirationDateTime: newExpiration.toISOString() });

        // Update stored record
        await db.container('observations').items.upsert({
          ...sub,
          expirationDateTime: newExpiration.toISOString(),
        });

        renewed++;
        context.log(`Renewed subscription ${sub.subscriptionId} for ${sub.resource}`);
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number }).statusCode;

        if (statusCode === 404) {
          // Subscription no longer exists in Graph — clean up
          context.warn(
            `Subscription ${sub.subscriptionId} not found in Graph, removing record`,
          );
          try {
            await db
              .container('observations')
              .item(sub.id, sub.retireeId)
              .delete();
            deleted++;
          } catch {
            // Best-effort cleanup
          }
          continue;
        }

        failed++;
        const message = error instanceof Error ? error.message : String(error);
        context.error(
          `Failed to renew subscription ${sub.subscriptionId}: ${message}`,
        );
      }
    }

    context.log(
      `Subscription renewal complete: ${renewed} renewed, ${failed} failed, ${deleted} removed`,
    );
  },
});
