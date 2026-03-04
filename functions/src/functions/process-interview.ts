// Blob trigger: process new interview transcripts through the pipeline

import { app, type InvocationContext } from '@azure/functions';
import { getCosmosClient, getSearchConfig, getOpenAIConfig, getGremlinConfig } from '../shared/config.js';

app.storageBlob('process-interview', {
  path: 'interview-transcripts/{blobName}',
  connection: 'AzureWebJobsStorage',
  handler: async (blob: Buffer, context: InvocationContext) => {
    const blobName = context.triggerMetadata?.['blobName'] as string ?? 'unknown';
    context.log(`Processing interview transcript: ${blobName}`);

    // Parse blob name for metadata: expected format "retireeId_sessionId.txt"
    const baseName = blobName.replace(/\.[^/.]+$/, '');
    const parts = baseName.split('_');
    const retireeId = parts[0] ?? 'unknown';
    const sessionId = parts[1] ?? baseName;

    const transcript = blob.toString('utf-8');

    if (!transcript.trim()) {
      context.log(`Skipping empty transcript: ${blobName}`);
      return;
    }

    try {
      const { client: cosmosClient, databaseId } = getCosmosClient();
      const db = cosmosClient.database(databaseId);
      const searchConfig = getSearchConfig();
      const openAiConfig = getOpenAIConfig();
      const gremlinConfig = getGremlinConfig();

      // Store processing metadata in Cosmos
      const processingRecord = {
        id: `proc-${sessionId}`,
        type: 'interview-processing',
        retireeId,
        sessionId,
        blobName,
        status: 'processing',
        startedAt: new Date().toISOString(),
        transcriptLength: transcript.length,
      };

      await db.container('observations').items.upsert(processingRecord);

      context.log(`Interview processing started`, {
        retireeId,
        sessionId,
        transcriptLength: transcript.length,
        searchEndpoint: searchConfig.endpoint,
        openAiEndpoint: openAiConfig.endpoint,
        gremlinEndpoint: gremlinConfig.endpoint,
      });

      // Store the transcript in Cosmos for downstream processing
      const transcriptRecord = {
        id: `transcript-${sessionId}`,
        type: 'transcript',
        retireeId,
        sessionId,
        content: transcript,
        createdAt: new Date().toISOString(),
      };

      await db.container('interviewSessions').items.upsert(transcriptRecord);

      // Update processing status
      await db.container('observations').items.upsert({
        ...processingRecord,
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      context.log(`Interview transcript stored and processing complete: ${sessionId}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      context.error(`Failed to process interview ${blobName}: ${message}`);

      // Attempt to record failure
      try {
        const { client: cosmosClient, databaseId } = getCosmosClient();
        await cosmosClient
          .database(databaseId)
          .container('observations')
          .items.upsert({
            id: `proc-${sessionId}`,
            type: 'interview-processing',
            retireeId,
            sessionId,
            blobName,
            status: 'failed',
            error: message,
            failedAt: new Date().toISOString(),
          });
      } catch {
        // Best-effort error recording
      }

      throw error;
    }
  },
});
