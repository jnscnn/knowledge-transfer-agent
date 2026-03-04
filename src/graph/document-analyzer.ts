// Analyze document activity for the Passive Observer module

import { logger } from '../shared/logger.js';
import type { GraphApiClient, GraphFile } from './graph-client.js';

export interface DocumentAnalysis {
  recentlyModified: GraphFile[];
  frequentlyAccessed: GraphFile[];
  sharedDocuments: GraphFile[];
  documentCategories: Record<string, number>;
}

export class DocumentAnalyzer {
  private graphClient: GraphApiClient;

  constructor(graphClient: GraphApiClient) {
    this.graphClient = graphClient;
  }

  async analyzeActivity(retireeId: string): Promise<DocumentAnalysis> {
    logger.info('Analyzing document activity', {
      component: 'DocumentAnalyzer',
      operation: 'analyzeActivity',
      retireeId,
    });

    const [recentFiles, sharedFiles] = await Promise.all([
      this.graphClient.getRecentFiles(retireeId),
      this.graphClient.getSharedFiles(retireeId),
    ]);

    // Sort by modification date to find recently modified
    const recentlyModified = [...recentFiles]
      .sort((a, b) => b.lastModifiedDateTime.getTime() - a.lastModifiedDateTime.getTime())
      .slice(0, 50);

    // Frequently accessed = files that appear in recent and were modified within last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const frequentlyAccessed = recentFiles.filter(
      (f) => f.lastModifiedDateTime >= thirtyDaysAgo,
    );

    const documentCategories = this.categorizeDocuments([...recentFiles, ...sharedFiles]);

    logger.info('Document analysis complete', {
      component: 'DocumentAnalyzer',
      retireeId,
      recentCount: String(recentlyModified.length),
      sharedCount: String(sharedFiles.length),
      categoryCount: String(Object.keys(documentCategories).length),
    });

    return {
      recentlyModified,
      frequentlyAccessed,
      sharedDocuments: sharedFiles,
      documentCategories,
    };
  }

  private categorizeDocuments(files: GraphFile[]): Record<string, number> {
    const categories: Record<string, number> = {};

    for (const file of files) {
      const category = this.inferCategory(file.name);
      categories[category] = (categories[category] ?? 0) + 1;
    }

    return categories;
  }

  private inferCategory(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const name = fileName.toLowerCase();

    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet';
    if (['pptx', 'ppt'].includes(ext)) return 'presentation';
    if (['docx', 'doc', 'pdf'].includes(ext)) return 'document';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'avi', 'mov', 'webm'].includes(ext)) return 'video';
    if (['zip', 'tar', 'gz', '7z'].includes(ext)) return 'archive';
    if (name.includes('spec') || name.includes('design')) return 'specification';
    if (name.includes('runbook') || name.includes('procedure')) return 'runbook';
    if (name.includes('diagram') || name.includes('architecture')) return 'architecture';

    return 'other';
  }
}
