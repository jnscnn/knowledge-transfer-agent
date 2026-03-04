import {
  SearchIndexClient,
  AzureKeyCredential,
  type SearchIndex,
  type LexicalAnalyzerName,
} from '@azure/search-documents';
import { logger } from '../shared/logger.js';

const INDEX_NAME = 'knowledge-chunks';
const VECTOR_DIMS = 3072;

function buildIndexDefinition(): SearchIndex {
  return {
    name: INDEX_NAME,
    fields: [
      { name: 'id', type: 'Edm.String', key: true, filterable: true },
      {
        name: 'content',
        type: 'Edm.String',
        searchable: true,
        analyzerName: 'en.microsoft' as LexicalAnalyzerName,
      },
      {
        name: 'summary',
        type: 'Edm.String',
        searchable: true,
        analyzerName: 'en.microsoft' as LexicalAnalyzerName,
      },
      {
        name: 'source_type',
        type: 'Edm.String',
        filterable: true,
        facetable: true,
      },
      {
        name: 'retiree_id',
        type: 'Edm.String',
        filterable: true,
        facetable: true,
      },
      {
        name: 'knowledge_domain',
        type: 'Edm.String',
        filterable: true,
        facetable: true,
        searchable: true,
      },
      {
        name: 'knowledge_type',
        type: 'Edm.String',
        filterable: true,
        facetable: true,
      },
      {
        name: 'sensitivity_level',
        type: 'Edm.String',
        filterable: true,
        facetable: true,
      },
      {
        name: 'consent_id',
        type: 'Edm.String',
        filterable: true,
      },
      {
        name: 'entities',
        type: 'Collection(Edm.String)',
        filterable: true,
        searchable: true,
      },
      {
        name: 'quality_score',
        type: 'Edm.Double',
        filterable: true,
        sortable: true,
      },
      {
        name: 'timestamp',
        type: 'Edm.DateTimeOffset',
        filterable: true,
        sortable: true,
      },
      {
        name: 'content_vector',
        type: 'Collection(Edm.Single)',
        searchable: true,
        vectorSearchDimensions: VECTOR_DIMS,
        vectorSearchProfileName: 'hnsw-content',
      },
      {
        name: 'hyde_vector',
        type: 'Collection(Edm.Single)',
        searchable: true,
        vectorSearchDimensions: VECTOR_DIMS,
        vectorSearchProfileName: 'hnsw-hyde',
      },
    ],
    vectorSearch: {
      algorithms: [
        {
          name: 'hnsw-algorithm',
          kind: 'hnsw',
          parameters: {
            m: 4,
            efConstruction: 400,
            efSearch: 500,
            metric: 'cosine',
          },
        },
      ],
      profiles: [
        { name: 'hnsw-content', algorithmConfigurationName: 'hnsw-algorithm' },
        { name: 'hnsw-hyde', algorithmConfigurationName: 'hnsw-algorithm' },
      ],
    },
    semanticSearch: {
      configurations: [
        {
          name: 'kt-semantic-config',
          prioritizedFields: {
            titleField: { name: 'summary' },
            contentFields: [{ name: 'content' }],
            keywordsFields: [{ name: 'entities' }],
          },
        },
      ],
    },
  };
}

async function createOrUpdateIndex(): Promise<void> {
  const endpoint = process.env['AZURE_SEARCH_ENDPOINT'];
  const apiKey = process.env['AZURE_SEARCH_API_KEY'];

  if (!endpoint || !apiKey) {
    console.error('AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_API_KEY are required');
    process.exit(1);
  }

  const indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(apiKey));
  const indexDef = buildIndexDefinition();

  logger.info(`Creating/updating search index: ${INDEX_NAME}`, {
    component: 'SearchIndexSetup',
  });

  try {
    await indexClient.createOrUpdateIndex(indexDef);
    console.log(`Search index '${INDEX_NAME}' created/updated successfully.`);
    console.log(`  Fields: ${indexDef.fields.length}`);
    console.log(`  Vector dimensions: ${VECTOR_DIMS}`);
    console.log('  Semantic configuration: kt-semantic-config');
  } catch (error) {
    console.error('Failed to create/update search index:', error);
    process.exit(1);
  }
}

export { buildIndexDefinition, INDEX_NAME };

// Run as standalone script
createOrUpdateIndex().catch((error: unknown) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
