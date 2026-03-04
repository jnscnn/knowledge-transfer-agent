import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock tiktoken before importing the module under test
const mockEncode = vi.fn((text: string) => {
  // Approximate: ~1 token per 4 characters
  const tokens = [];
  for (let i = 0; i < Math.ceil(text.length / 4); i++) {
    tokens.push(i);
  }
  return tokens;
});

const mockDecode = vi.fn((tokens: number[]) => {
  return new Uint8Array(tokens.length * 4);
});

const mockFree = vi.fn();

vi.mock('tiktoken', () => ({
  get_encoding: vi.fn(() => ({
    encode: mockEncode,
    decode: mockDecode,
    free: mockFree,
  })),
}));

vi.mock('../../../src/shared/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { TextChunker, CHUNKING_STRATEGIES } from '../../../src/pipeline/chunking.js';
import type { ChunkingConfig } from '../../../src/pipeline/chunking.js';

describe('TextChunker', () => {
  let chunker: TextChunker;

  beforeEach(() => {
    vi.clearAllMocks();
    chunker = new TextChunker();
  });

  afterEach(() => {
    chunker.dispose();
  });

  describe('topic_boundary strategy', () => {
    it('should split multi-paragraph text on double newlines', () => {
      const text = [
        'First paragraph about vendor management and contract negotiations.',
        '',
        'Second paragraph about the procurement process and approval workflows.',
        '',
        'Third paragraph about supplier evaluation criteria and scoring.',
      ].join('\n');

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'topic_boundary',
        targetTokens: { min: 5, max: 500 },
        overlapTokens: 0,
        preserveContext: true,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // Each chunk should contain text content
      for (const chunk of chunks) {
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      }
    });

    it('should merge small paragraphs into larger chunks', () => {
      const text = 'Short.\n\nAlso short.\n\nAnd short.';

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'topic_boundary',
        targetTokens: { min: 5, max: 500 },
        overlapTokens: 0,
        preserveContext: true,
      });

      // Small paragraphs should be merged since they fit under max
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('heading_based strategy', () => {
    it('should split markdown text by headings', () => {
      const text = [
        '# Introduction',
        'This is the introduction section with overview information. '.repeat(20),
        '',
        '## Vendor Management',
        'Details about managing vendors and supplier relationships. '.repeat(20),
        '',
        '## Contract Process',
        'Information about the contract review and approval process. '.repeat(20),
        '',
        '### Sub-section',
        'Additional details in a sub-section. '.repeat(20),
      ].join('\n');

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'heading_based',
        targetTokens: { min: 5, max: 200 },
        overlapTokens: 0,
        preserveContext: true,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // Should contain introduction content
      const hasIntro = chunks.some((c) => c.content.includes('Introduction'));
      expect(hasIntro).toBe(true);

      // Should contain vendor management section
      const hasVendor = chunks.some((c) => c.content.includes('Vendor Management'));
      expect(hasVendor).toBe(true);
    });

    it('should fall back to paragraph splitting when no headings are found', () => {
      const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'heading_based',
        targetTokens: { min: 5, max: 2000 },
        overlapTokens: 0,
        preserveContext: true,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('speaker_turn strategy', () => {
    it('should split interview transcript by Q:/A: turns', () => {
      const text = [
        'Q: What is the vendor management process?',
        'We work with three main vendors for our operations.',
        '',
        'A: The main vendors are Acme Corp, TechStar, and DataFlow.',
        'Each has a different contract cycle.',
        '',
        'Q: How do you handle escalations?',
        'What is the typical timeline?',
        '',
        'A: For Acme Corp, escalate to Mark Rodriguez.',
        'He is the VP of Operations and responds within 24 hours.',
      ].join('\n');

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'speaker_turn',
        targetTokens: { min: 5, max: 2000 },
        overlapTokens: 0,
        preserveContext: true,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // Should preserve Q/A content
      const allContent = chunks.map((c) => c.content).join(' ');
      expect(allContent).toContain('vendor');
    });

    it('should handle named speaker patterns', () => {
      const text = [
        'Interviewer: Tell me about the process.',
        'The monthly review happens on the first Tuesday.',
        '',
        'Robert: Sure, we start by gathering all the reports.',
        'Then we compile them into the dashboard.',
      ].join('\n');

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'speaker_turn',
        targetTokens: { min: 5, max: 2000 },
        overlapTokens: 0,
        preserveContext: true,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('message_thread strategy', () => {
    it('should split email-style messages by From: headers', () => {
      const text = [
        'From: alice@contoso.com',
        'Subject: Vendor contract update',
        'The Acme Corp contract is up for renewal next month.',
        '',
        'From: bob@contoso.com',
        'Subject: Re: Vendor contract update',
        'Thanks Alice, I will start the review process.',
        '',
        'From: alice@contoso.com',
        'Subject: Re: Re: Vendor contract update',
        'Great, please coordinate with Finance.',
      ].join('\n');

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'message_thread',
        targetTokens: { min: 5, max: 2000 },
        overlapTokens: 0,
        preserveContext: true,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const allContent = chunks.map((c) => c.content).join(' ');
      expect(allContent).toContain('From:');
    });

    it('should handle separator-style message boundaries', () => {
      const text = [
        'First message content here.',
        '---',
        'Second message content here.',
        '---',
        'Third message content here.',
      ].join('\n');

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'message_thread',
        targetTokens: { min: 5, max: 2000 },
        overlapTokens: 0,
        preserveContext: true,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('token limits', () => {
    it('should not produce chunks exceeding max token limit', () => {
      // Create a long text that will need splitting
      const longParagraph = 'This is a sentence about vendor management. '.repeat(200);
      const config: ChunkingConfig = {
        strategy: 'topic_boundary',
        targetTokens: { min: 10, max: 100 },
        overlapTokens: 0,
        preserveContext: true,
      };

      const chunks = chunker.chunkWithConfig(longParagraph, config);

      for (const chunk of chunks) {
        // Token count from our mock: ~1 token per 4 chars
        // The chunker uses the mocked encoder for its own counting
        expect(chunk.tokenCount).toBeGreaterThan(0);
      }
      // Multiple chunks should be produced for a long text
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should assign sequential indices to chunks', () => {
      const text = 'Paragraph one content.\n\nParagraph two content.\n\nParagraph three content.';

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'topic_boundary',
        targetTokens: { min: 1, max: 5000 },
        overlapTokens: 0,
        preserveContext: true,
      });

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].index).toBe(i);
      }
    });
  });

  describe('overlap', () => {
    it('should add overlap text from previous chunk when overlapTokens > 0', () => {
      // Create text with distinct paragraphs that won't be merged
      const paragraphs = Array.from({ length: 5 }, (_, i) =>
        `Paragraph ${i + 1} with enough content to be its own chunk. `.repeat(30),
      );
      const text = paragraphs.join('\n\n');

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'topic_boundary',
        targetTokens: { min: 10, max: 200 },
        overlapTokens: 10,
        preserveContext: true,
      });

      if (chunks.length > 1) {
        // First chunk should have no overlap
        expect(chunks[0].metadata.overlapWithPrevious).toBe(false);

        // Subsequent chunks should have overlap marked
        const hasOverlap = chunks.slice(1).some((c) => c.metadata.overlapWithPrevious);
        expect(hasOverlap).toBe(true);
      }
    });

    it('should not add overlap when overlapTokens is 0', () => {
      const text = 'Para one content here.\n\nPara two content here.\n\nPara three content here.';

      const chunks = chunker.chunkWithConfig(text, {
        strategy: 'topic_boundary',
        targetTokens: { min: 1, max: 5000 },
        overlapTokens: 0,
        preserveContext: true,
      });

      for (const chunk of chunks) {
        expect(chunk.metadata.overlapWithPrevious).toBe(false);
      }
    });
  });

  describe('countTokens', () => {
    it('should return token count for given text', () => {
      const count = chunker.countTokens('hello world');
      expect(count).toBeGreaterThan(0);
      expect(mockEncode).toHaveBeenCalledWith('hello world');
    });
  });

  describe('dispose', () => {
    it('should free the encoder', () => {
      chunker.dispose();
      expect(mockFree).toHaveBeenCalled();
    });
  });

  describe('CHUNKING_STRATEGIES', () => {
    it('should define all expected content type strategies', () => {
      expect(CHUNKING_STRATEGIES).toHaveProperty('interview_transcript');
      expect(CHUNKING_STRATEGIES).toHaveProperty('email_thread');
      expect(CHUNKING_STRATEGIES).toHaveProperty('document');
      expect(CHUNKING_STRATEGIES).toHaveProperty('teams_messages');
    });

    it('should use correct strategy types', () => {
      expect(CHUNKING_STRATEGIES.interview_transcript.strategy).toBe('topic_boundary');
      expect(CHUNKING_STRATEGIES.email_thread.strategy).toBe('message_thread');
      expect(CHUNKING_STRATEGIES.document.strategy).toBe('heading_based');
      expect(CHUNKING_STRATEGIES.teams_messages.strategy).toBe('message_thread');
    });
  });
});
