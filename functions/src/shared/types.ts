// Shared types for Azure Functions (subset of main project types, kept self-contained)

export interface GraphNotification {
  subscriptionId: string;
  changeType: 'created' | 'updated' | 'deleted';
  resource: string;
  resourceData: {
    id: string;
    '@odata.type': string;
    '@odata.id': string;
    '@odata.etag'?: string;
  };
  clientState: string;
  tenantId: string;
}

export interface GraphNotificationPayload {
  value: GraphNotification[];
}

export interface SubscriptionRecord {
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

export interface ConsistencyResult {
  timestamp: string;
  cosmosCount: number;
  searchCount: number;
  gremlinEntityCount: number;
  missingInSearch: string[];
  missingInCosmos: string[];
  orphanedInGremlin: string[];
  isConsistent: boolean;
}
