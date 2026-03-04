// Semantic text chunking with multiple strategies

import { get_encoding, type Tiktoken } from 'tiktoken';
import { logger } from '../shared/logger.js';

export interface ChunkingConfig {
  strategy: 'topic_boundary' | 'heading_based' | 'speaker_turn' | 'message_thread';
  targetTokens: { min: number; max: number };
  overlapTokens: number;
  preserveContext: boolean;
}

export interface TextChunk {
  content: string;
  index: number;
  tokenCount: number;
  metadata: {
    startOffset: number;
    endOffset: number;
    overlapWithPrevious: boolean;
  };
}

export const CHUNKING_STRATEGIES = {
  interview_transcript: {
    strategy: 'topic_boundary' as const,
    targetTokens: { min: 500, max: 1000 },
    overlapTokens: 50,
    preserveContext: true,
  },
  email_thread: {
    strategy: 'message_thread' as const,
    targetTokens: { min: 300, max: 500 },
    overlapTokens: 30,
    preserveContext: true,
  },
  document: {
    strategy: 'heading_based' as const,
    targetTokens: { min: 500, max: 1000 },
    overlapTokens: 50,
    preserveContext: true,
  },
  teams_messages: {
    strategy: 'message_thread' as const,
    targetTokens: { min: 200, max: 500 },
    overlapTokens: 20,
    preserveContext: true,
  },
} satisfies Record<string, ChunkingConfig>;

export class TextChunker {
  private encoder: Tiktoken;

  constructor() {
    this.encoder = get_encoding('cl100k_base');
  }

  chunkText(text: string, contentType: keyof typeof CHUNKING_STRATEGIES): TextChunk[] {
    const config = CHUNKING_STRATEGIES[contentType];
    return this.chunkWithConfig(text, config);
  }

  chunkWithConfig(text: string, config: ChunkingConfig): TextChunk[] {
    logger.debug('Chunking text', {
      component: 'TextChunker',
      strategy: config.strategy,
      textLength: String(text.length),
    });

    let segments: string[];
    switch (config.strategy) {
      case 'topic_boundary':
        segments = this.splitByTopicBoundary(text);
        break;
      case 'heading_based':
        segments = this.splitByHeadings(text);
        break;
      case 'speaker_turn':
        segments = this.splitBySpeakerTurn(text);
        break;
      case 'message_thread':
        segments = this.splitByMessageThread(text);
        break;
    }

    const merged = this.mergeAndSplitSegments(segments, config);
    const chunks = this.buildChunks(merged, text, config);

    logger.debug('Chunking complete', {
      component: 'TextChunker',
      chunkCount: String(chunks.length),
    });

    return chunks;
  }

  countTokens(text: string): number {
    return this.encoder.encode(text).length;
  }

  dispose(): void {
    this.encoder.free();
  }

  // ── Strategy implementations ──

  private splitByTopicBoundary(text: string): string[] {
    // Split on double newlines (paragraph boundaries)
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    return paragraphs.map((p) => p.trim());
  }

  private splitByHeadings(text: string): string[] {
    // Split on markdown headings, keeping the heading with its content
    const sections: string[] = [];
    const headingPattern = /^(#{1,6}\s.+)$/gm;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = headingPattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const before = text.slice(lastIndex, match.index).trim();
        if (before.length > 0) {
          sections.push(before);
        }
      }
      lastIndex = match.index;
    }

    // Push remaining content (includes last heading + its body)
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex).trim();
      if (remaining.length > 0) {
        sections.push(remaining);
      }
    }

    // If no headings found, fall back to paragraph splitting
    if (sections.length === 0) {
      return this.splitByTopicBoundary(text);
    }

    return sections;
  }

  private splitBySpeakerTurn(text: string): string[] {
    // Split on speaker change patterns: "Q:", "A:", "Name:", etc.
    const speakerPattern = /^(?:[A-Z][a-zA-Z\s]*:|Q:|A:)\s*/gm;
    const segments: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = speakerPattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const segment = text.slice(lastIndex, match.index).trim();
        if (segment.length > 0) {
          segments.push(segment);
        }
      }
      lastIndex = match.index;
    }

    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex).trim();
      if (remaining.length > 0) {
        segments.push(remaining);
      }
    }

    if (segments.length === 0) {
      return this.splitByTopicBoundary(text);
    }

    return segments;
  }

  private splitByMessageThread(text: string): string[] {
    // Split on message boundaries: "From:", "---", timestamps, etc.
    const messagePattern = /^(?:From:|---+|\d{1,2}[/:]\d{2}\s*(?:AM|PM)?)/gm;
    const segments: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = messagePattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const segment = text.slice(lastIndex, match.index).trim();
        if (segment.length > 0) {
          segments.push(segment);
        }
      }
      lastIndex = match.index;
    }

    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex).trim();
      if (remaining.length > 0) {
        segments.push(remaining);
      }
    }

    // Fall back to double-newline splitting if no message boundaries found
    if (segments.length === 0) {
      return this.splitByTopicBoundary(text);
    }

    return segments;
  }

  // ── Merge small segments / split large segments ──

  private mergeAndSplitSegments(segments: string[], config: ChunkingConfig): string[] {
    const result: string[] = [];
    let buffer = '';

    for (const segment of segments) {
      const segmentTokens = this.countTokens(segment);

      if (segmentTokens > config.targetTokens.max) {
        // Flush buffer first
        if (buffer.length > 0) {
          result.push(buffer.trim());
          buffer = '';
        }
        // Split oversized segment by sentences
        const subSegments = this.splitLargeSegment(segment, config.targetTokens.max);
        result.push(...subSegments);
      } else if (buffer.length > 0) {
        const combined = buffer + '\n\n' + segment;
        const combinedTokens = this.countTokens(combined);
        if (combinedTokens > config.targetTokens.max) {
          result.push(buffer.trim());
          buffer = segment;
        } else {
          buffer = combined;
        }
      } else {
        buffer = segment;
      }
    }

    if (buffer.trim().length > 0) {
      result.push(buffer.trim());
    }

    return result;
  }

  private splitLargeSegment(segment: string, maxTokens: number): string[] {
    const sentences = segment.split(/(?<=[.!?])\s+/);
    const results: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      const candidate = current.length > 0 ? current + ' ' + sentence : sentence;
      if (this.countTokens(candidate) > maxTokens && current.length > 0) {
        results.push(current.trim());
        current = sentence;
      } else {
        current = candidate;
      }
    }

    if (current.trim().length > 0) {
      results.push(current.trim());
    }

    return results;
  }

  // ── Build final chunks with overlap and metadata ──

  private buildChunks(segments: string[], originalText: string, config: ChunkingConfig): TextChunk[] {
    const chunks: TextChunk[] = [];

    for (let i = 0; i < segments.length; i++) {
      let content = segments[i];
      let hasOverlap = false;

      // Add overlap from previous segment
      if (i > 0 && config.overlapTokens > 0) {
        const overlapText = this.getOverlapText(segments[i - 1], config.overlapTokens);
        if (overlapText.length > 0) {
          content = overlapText + '\n\n' + content;
          hasOverlap = true;
        }
      }

      const startOffset = originalText.indexOf(segments[i]);
      const endOffset = startOffset >= 0 ? startOffset + segments[i].length : -1;

      chunks.push({
        content,
        index: i,
        tokenCount: this.countTokens(content),
        metadata: {
          startOffset: Math.max(0, startOffset),
          endOffset: Math.max(0, endOffset),
          overlapWithPrevious: hasOverlap,
        },
      });
    }

    return chunks;
  }

  private getOverlapText(text: string, overlapTokens: number): string {
    const tokens = this.encoder.encode(text);
    if (tokens.length <= overlapTokens) {
      return text;
    }
    const overlapTokenSlice = tokens.slice(tokens.length - overlapTokens);
    return new TextDecoder().decode(this.encoder.decode(overlapTokenSlice));
  }
}
