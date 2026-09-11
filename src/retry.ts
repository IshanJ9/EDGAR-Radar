export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

function backoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  // Jitter (50-100% of the exponential value) avoids every retry landing on
  // the exact same schedule if multiple requests fail around the same time.
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

/**
 * Retries a fetch on network errors and 5xx server responses - both
 * transient conditions a later attempt might succeed at. Does NOT retry 4xx
 * responses (404, 403, etc.): those are permanent failures against this
 * specific request that a retry can't fix.
 */
export async function fetchWithRetry(doFetch: () => Promise<Response>, options: RetryOptions = {}): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await doFetch();
      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        lastError = new Error(`Transient server error: ${response.status}`);
        await sleep(backoffDelay(attempt, baseDelayMs));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(backoffDelay(attempt, baseDelayMs));
        continue;
      }
    }
  }
  throw lastError;
}
