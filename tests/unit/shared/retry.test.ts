import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { withRetry } from '../../../src/shared/retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('successful on first attempt', () => {
    it('should return result without retrying', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry on transient error', () => {
    it('should succeed on second attempt after 429 error', async () => {
      const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
      const fn = vi.fn()
        .mockRejectedValueOnce(error429)
        .mockResolvedValue('success');

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, jitter: false });
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500+ server errors', async () => {
      const error500 = Object.assign(new Error('Server error'), { statusCode: 500 });
      const fn = vi.fn()
        .mockRejectedValueOnce(error500)
        .mockResolvedValue('recovered');

      const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 50, jitter: false });
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('max retries exceeded', () => {
    it('should throw after exhausting all retries', async () => {
      vi.useRealTimers();
      const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
      const fn = vi.fn().mockRejectedValue(error429);

      await expect(
        withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, jitter: false }),
      ).rejects.toThrow('Rate limited');

      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
      vi.useFakeTimers();
    });
  });

  describe('exponential backoff', () => {
    it('should increase delay exponentially between retries', async () => {
      vi.useRealTimers();
      const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
      const fn = vi.fn().mockRejectedValue(error429);

      const delays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;

      // Patch setTimeout to capture delays
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
        ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
          if (ms !== undefined && ms >= 10) {
            delays.push(ms);
          }
          return originalSetTimeout(callback, 1, ...args);
        }) as typeof setTimeout,
      );

      await expect(
        withRetry(fn, {
          maxRetries: 3,
          baseDelayMs: 100,
          maxDelayMs: 30000,
          jitter: false,
        }),
      ).rejects.toThrow('Rate limited');

      // Delays should be: 100 (2^0*100), 200 (2^1*100), 400 (2^2*100)
      expect(delays.length).toBe(3);
      expect(delays[1]).toBeGreaterThan(delays[0]);
      expect(delays[2]).toBeGreaterThan(delays[1]);

      setTimeoutSpy.mockRestore();
      vi.useFakeTimers();
    });
  });

  describe('jitter', () => {
    it('should add randomness when jitter is enabled', async () => {
      vi.useRealTimers();
      const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
      const fn = vi.fn().mockRejectedValue(error429);

      const mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

      await expect(
        withRetry(fn, {
          maxRetries: 1,
          baseDelayMs: 1,
          maxDelayMs: 5,
          jitter: true,
        }),
      ).rejects.toThrow('Rate limited');

      expect(mathRandomSpy).toHaveBeenCalled();

      mathRandomSpy.mockRestore();
      vi.useFakeTimers();
    });
  });

  describe('custom retryOn predicate', () => {
    it('should only retry when predicate returns true', async () => {
      const retryableError = new Error('retryable');

      const fn = vi.fn().mockRejectedValueOnce(retryableError).mockResolvedValue('ok');

      const promise = withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 50,
        jitter: false,
        retryOn: (err) => err instanceof Error && err.message === 'retryable',
      });

      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry when predicate returns false', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fatal'));

      await expect(
        withRetry(fn, {
          maxRetries: 3,
          baseDelayMs: 50,
          jitter: false,
          retryOn: () => false,
        }),
      ).rejects.toThrow('fatal');

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('non-retryable errors (default predicate)', () => {
    it('should not retry on non-transient errors by default', async () => {
      const error400 = Object.assign(new Error('Bad request'), { statusCode: 400 });
      const fn = vi.fn().mockRejectedValue(error400);

      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 50, jitter: false }),
      ).rejects.toThrow('Bad request');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry plain Error without status code', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('generic error'));

      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 50, jitter: false }),
      ).rejects.toThrow('generic error');

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
