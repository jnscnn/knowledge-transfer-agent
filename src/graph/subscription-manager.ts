// Manage Microsoft Graph API change notification subscriptions

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../shared/logger.js';
import { GraphApiError } from '../shared/errors.js';
import { withRetry } from '../shared/retry.js';
import type { CosmosNoSqlClient } from '../storage/cosmos-nosql-client.js';
import type { GraphApiClient } from './graph-client.js';

// ── Interfaces ──

export interface GraphSubscription {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState: string;
  retireeId: string;
  createdAt: string;
}

interface SubscriptionRecord {
  id: string;
  subscriptionId: string;
  retireeId: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState: string;
  createdAt: string;
}

// Subscription maximum lifetime: 3 days (4230 minutes) for most resources
const MAX_SUBSCRIPTION_LIFETIME_HOURS = 70;

const SUBSCRIPTION_RESOURCES = [
  { resource: (userId: string) => `/users/${userId}/messages`, changeType: 'created' },
  { resource: (userId: string) => `/users/${userId}/events`, changeType: 'created,updated' },
  { resource: (userId: string) => `/users/${userId}/drive/root`, changeType: 'updated' },
] as const;

// ── Manager ──

export class SubscriptionManager {
  private graphClient: GraphApiClient;
  private cosmosClient: CosmosNoSqlClient | undefined;

  constructor(graphClient: GraphApiClient, cosmosClient?: CosmosNoSqlClient) {
    this.graphClient = graphClient;
    this.cosmosClient = cosmosClient;
  }

  async createSubscriptions(
    retireeId: string,
    webhookUrl: string,
  ): Promise<GraphSubscription[]> {
    logger.info('Creating Graph subscriptions', {
      component: 'SubscriptionManager',
      operation: 'createSubscriptions',
      retireeId,
    });

    const subscriptions: GraphSubscription[] = [];
    const expiration = new Date();
    expiration.setHours(expiration.getHours() + MAX_SUBSCRIPTION_LIFETIME_HOURS);

    for (const def of SUBSCRIPTION_RESOURCES) {
      const clientState = uuidv4();
      const resource = def.resource(retireeId);

      try {
        const response = await withRetry(
          () =>
            this.graphClient.rawClient
              .api('/subscriptions')
              .post({
                changeType: def.changeType,
                notificationUrl: webhookUrl,
                resource,
                expirationDateTime: expiration.toISOString(),
                clientState,
              }),
          { maxRetries: 2, baseDelayMs: 2_000 },
        );

        const sub = response as Record<string, unknown>;
        const subscription: GraphSubscription = {
          id: String(sub['id'] ?? ''),
          resource,
          changeType: def.changeType,
          notificationUrl: webhookUrl,
          expirationDateTime: String(sub['expirationDateTime'] ?? expiration.toISOString()),
          clientState,
          retireeId,
          createdAt: new Date().toISOString(),
        };

        subscriptions.push(subscription);

        // Persist to Cosmos for renewal tracking
        if (this.cosmosClient) {
          await this.cosmosClient.upsert<Record<string, unknown>>(
            'observations',
            {
              id: `sub-${subscription.id}`,
              type: 'subscription',
              subscriptionId: subscription.id,
              retireeId,
              resource,
              changeType: def.changeType,
              notificationUrl: webhookUrl,
              expirationDateTime: subscription.expirationDateTime,
              clientState,
              createdAt: subscription.createdAt,
            },
            retireeId,
          );
        }

        logger.info('Subscription created', {
          component: 'SubscriptionManager',
          subscriptionId: subscription.id,
          resource,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to create subscription for ${resource}`, {
          component: 'SubscriptionManager',
          operation: 'createSubscriptions',
          error: error instanceof Error ? error : undefined,
        });
        throw new GraphApiError(
          `Failed to create subscription for ${resource}: ${message}`,
          { retireeId, resource },
        );
      }
    }

    logger.info('All subscriptions created', {
      component: 'SubscriptionManager',
      retireeId,
      count: String(subscriptions.length),
    });

    return subscriptions;
  }

  async renewSubscriptions(): Promise<void> {
    logger.info('Renewing Graph subscriptions', {
      component: 'SubscriptionManager',
      operation: 'renewSubscriptions',
    });

    if (!this.cosmosClient) {
      logger.warn('No Cosmos client configured; cannot query subscriptions for renewal', {
        component: 'SubscriptionManager',
      });
      return;
    }

    // Find subscriptions expiring within the next 24 hours
    const threshold = new Date();
    threshold.setHours(threshold.getHours() + 24);

    const records = await this.cosmosClient.query<SubscriptionRecord>('observations', {
      query:
        'SELECT * FROM c WHERE c.type = "subscription" AND c.expirationDateTime < @threshold',
      parameters: [{ name: '@threshold', value: threshold.toISOString() }],
    });

    const newExpiration = new Date();
    newExpiration.setHours(newExpiration.getHours() + MAX_SUBSCRIPTION_LIFETIME_HOURS);

    let renewed = 0;
    let failed = 0;

    for (const record of records) {
      try {
        await withRetry(
          () =>
            this.graphClient.rawClient
              .api(`/subscriptions/${record.subscriptionId}`)
              .patch({ expirationDateTime: newExpiration.toISOString() }),
          { maxRetries: 2, baseDelayMs: 2_000 },
        );

        // Update the stored expiration
        if (this.cosmosClient) {
          await this.cosmosClient.upsert<Record<string, unknown>>(
            'observations',
            { ...record, expirationDateTime: newExpiration.toISOString() } as unknown as Record<string, unknown>,
            record.retireeId,
          );
        }

        renewed++;
      } catch (error: unknown) {
        failed++;
        logger.error(`Failed to renew subscription ${record.subscriptionId}`, {
          component: 'SubscriptionManager',
          operation: 'renewSubscriptions',
          subscriptionId: record.subscriptionId,
          error: error instanceof Error ? error : undefined,
        });
      }
    }

    logger.info('Subscription renewal complete', {
      component: 'SubscriptionManager',
      renewed: String(renewed),
      failed: String(failed),
      total: String(records.length),
    });
  }

  async deleteSubscriptions(retireeId: string): Promise<void> {
    logger.info('Deleting subscriptions for retiree', {
      component: 'SubscriptionManager',
      operation: 'deleteSubscriptions',
      retireeId,
    });

    if (!this.cosmosClient) {
      logger.warn('No Cosmos client configured; cannot query subscriptions for deletion', {
        component: 'SubscriptionManager',
      });
      return;
    }

    const records = await this.cosmosClient.query<SubscriptionRecord>('observations', {
      query: 'SELECT * FROM c WHERE c.type = "subscription" AND c.retireeId = @retireeId',
      parameters: [{ name: '@retireeId', value: retireeId }],
    });

    for (const record of records) {
      try {
        await this.graphClient.rawClient
          .api(`/subscriptions/${record.subscriptionId}`)
          .delete();
      } catch (error: unknown) {
        logger.warn(`Failed to delete subscription ${record.subscriptionId} from Graph`, {
          component: 'SubscriptionManager',
          error: error instanceof Error ? error : undefined,
        });
      }

      // Remove from Cosmos regardless
      try {
        await this.cosmosClient.delete('observations', record.id, retireeId);
      } catch {
        // Best-effort cleanup
      }
    }

    logger.info('Subscriptions deleted', {
      component: 'SubscriptionManager',
      retireeId,
      count: String(records.length),
    });
  }

  /** Respond to the Graph API validation handshake */
  handleValidation(validationToken: string): string {
    logger.info('Handling Graph webhook validation', {
      component: 'SubscriptionManager',
      operation: 'handleValidation',
    });
    return validationToken;
  }
}
