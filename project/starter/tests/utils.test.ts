import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  RateLimiter,
  withRateLimit,
  ReviewError,
  ErrorCodes,
  withRetry,
  withTimeout,
  isReviewError,
  formatError
} from '../src/utils';

afterEach(() => {
  vi.useRealTimers();
});

describe('error handler', () => {
  describe('withRetry', () => {
    it('returns the result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries until success', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('a'))
        .mockRejectedValueOnce(new Error('b'))
        .mockResolvedValue('ok');
      await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws RETRY_EXHAUSTED after all attempts fail', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('boom'));
      const error = await withRetry(fn, 3, 1).catch(e => e);
      expect(isReviewError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.RETRY_EXHAUSTED);
      expect(error.message).toContain('boom');
      expect(error.metadata.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('uses exponential backoff with jitter', async () => {
      vi.useFakeTimers();
      const fn = vi.fn().mockRejectedValue(new Error('x'));
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      const promise = withRetry(fn, 3, 1000).catch(e => e);

      await vi.advanceTimersByTimeAsync(999);
      expect(fn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); // 1000ms: second attempt
      expect(fn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1999);
      expect(fn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1); // +2000ms: third attempt
      expect(fn).toHaveBeenCalledTimes(3);

      await promise;
      random.mockRestore();
    });
  });

  describe('withTimeout', () => {
    it('resolves when the function finishes in time', async () => {
      await expect(withTimeout(async () => 42, 100)).resolves.toBe(42);
    });

    it('rejects with AGENT_TIMEOUT when too slow', async () => {
      const error = await withTimeout(() => new Promise(() => {}), 10, 'too slow').catch(e => e);
      expect(error).toBeInstanceOf(ReviewError);
      expect(error.code).toBe(ErrorCodes.AGENT_TIMEOUT);
      expect(error.message).toBe('too slow');
      expect(error.metadata.timeoutMs).toBe(10);
    });

    it('propagates errors from the function', async () => {
      await expect(
        withTimeout(async () => {
          throw new Error('inner');
        }, 100)
      ).rejects.toThrow('inner');
    });
  });

  describe('formatError', () => {
    it('formats ReviewError, Error and unknown values', () => {
      expect(formatError(new ReviewError('m', 'C'))).toBe('[C] m');
      expect(formatError(new Error('plain'))).toBe('plain');
      expect(formatError('str')).toBe('str');
    });
  });
});

describe('RateLimiter', () => {
  it('allows requests under the limits', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2 });
    expect(limiter.canProceed()).toBe(true);
    await limiter.acquire(500);
    expect(limiter.getStatus()).toMatchObject({ activeRequests: 1, requestsInWindow: 1, tokensInWindow: 500 });
  });

  it('blocks when the concurrent limit is reached and resumes on release', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    await limiter.acquire();
    expect(limiter.canProceed()).toBe(false);

    let acquired = false;
    const second = limiter.acquire().then(() => {
      acquired = true;
    });
    await new Promise(r => setTimeout(r, 20));
    expect(acquired).toBe(false);

    limiter.release();
    await second;
    expect(acquired).toBe(true);
    expect(limiter.getStatus().activeRequests).toBe(1);
  });

  it('blocks when the token budget would be exceeded', async () => {
    const limiter = new RateLimiter({ maxTokensPerMinute: 1000, maxConcurrent: 10 });
    await limiter.acquire(800);
    limiter.release();
    expect(limiter.canProceed(300)).toBe(false);
    expect(limiter.canProceed(200)).toBe(true);
  });

  it('blocks when the request budget is exhausted', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxConcurrent: 10 });
    await limiter.acquire(1);
    limiter.release();
    await limiter.acquire(1);
    limiter.release();
    expect(limiter.canProceed(1)).toBe(false);
  });

  it('forgets requests older than 60 seconds', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxConcurrent: 10 });
    await limiter.acquire(1);
    limiter.release();
    expect(limiter.canProceed(1)).toBe(false);

    vi.advanceTimersByTime(60001);
    expect(limiter.canProceed(1)).toBe(true);
    expect(limiter.getStatus().requestsInWindow).toBe(0);
  });

  it('waits for the window to slide before proceeding', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxConcurrent: 10 });
    await limiter.acquire(1);
    limiter.release();

    let acquired = false;
    const second = limiter.acquire(1).then(() => {
      acquired = true;
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(acquired).toBe(false);
    await vi.advanceTimersByTimeAsync(31000);
    await second;
    expect(acquired).toBe(true);
  });

  it('updates the token count on release', async () => {
    const limiter = new RateLimiter();
    await limiter.acquire(1000);
    limiter.release(250);
    expect(limiter.getStatus().tokensInWindow).toBe(250);
  });

  it('withRateLimit releases the slot even when the function throws', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    await expect(
      withRateLimit(limiter, async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');
    expect(limiter.getStatus().activeRequests).toBe(0);
    await expect(withRateLimit(limiter, async () => 'ok')).resolves.toBe('ok');
  });
});
