import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  retryOn?: (error: unknown) => boolean;
  getRetryDelay?: (error: unknown, attempt: number) => number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitter: true,
};

function isRetryableByDefault(error: unknown): boolean {
  if (error instanceof Error) {
    const statusCode = (error as { statusCode?: number }).statusCode
      ?? (error as { status?: number }).status;
    if (statusCode === 429) return true;
    if (statusCode !== undefined && statusCode >= 500) return true;
  }
  return false;
}

function getRetryAfterMs(error: unknown): number | undefined {
  const headers = (error as { headers?: Record<string, string> }).headers;
  const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (!retryAfter) return undefined;

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) return seconds * 1_000;

  const date = Date.parse(retryAfter);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return undefined;
}

function computeDelay(attempt: number, options: RetryOptions, error: unknown): number {
  if (options.getRetryDelay) {
    return options.getRetryDelay(error, attempt);
  }

  const retryAfterMs = getRetryAfterMs(error);
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, options.maxDelayMs);
  }

  const exponential = options.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, options.maxDelayMs);
  if (!options.jitter) return capped;

  return capped * (0.5 + Math.random() * 0.5);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  const shouldRetry = opts.retryOn ?? isRetryableByDefault;

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      if (attempt >= opts.maxRetries || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = computeDelay(attempt, opts, error);
      logger.warn('Retrying after error', {
        attempt: attempt + 1,
        maxRetries: opts.maxRetries,
        delayMs: Math.round(delayMs),
        error: error instanceof Error ? error.message : String(error),
      });

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
