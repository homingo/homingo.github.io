export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 5,
  baseDelayMs: 2000,
  maxDelayMs: 60000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limits, overloaded, network errors
    if (msg.includes("rate") || msg.includes("429") || msg.includes("overloaded")) return true;
    if (msg.includes("529") || msg.includes("500") || msg.includes("503")) return true;
    if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("fetch failed"))
      return true;
  }

  // Check for status code on Anthropic/OpenAI API errors
  const err = error as { status?: number };
  if (err.status === 429 || err.status === 529 || err.status === 500 || err.status === 503)
    return true;

  return false;
}

/**
 * Extract Retry-After value from error headers (in milliseconds).
 * Anthropic SDK errors include `headers` as a plain object.
 * Fetch-style errors may use a Headers object with `.get()`.
 */
function extractRetryAfter(error: unknown): number | undefined {
  const err = error as {
    headers?: Record<string, string> & { get?: (key: string) => string | null };
  };

  if (!err.headers) return undefined;

  let value: string | null | undefined;

  // Anthropic SDK: error.headers['retry-after']
  if (typeof err.headers["retry-after"] === "string") {
    value = err.headers["retry-after"];
  } else if (typeof err.headers["retry-after-ms"] === "string") {
    // Some providers return milliseconds directly
    const ms = parseInt(err.headers["retry-after-ms"], 10);
    return isNaN(ms) ? undefined : ms;
  } else if (typeof err.headers.get === "function") {
    // Fetch-style Headers object
    value = err.headers.get("retry-after") || err.headers.get("retry-after-ms");
    if (value && err.headers.get("retry-after-ms")) {
      const ms = parseInt(value, 10);
      return isNaN(ms) ? undefined : ms;
    }
  }

  if (!value) return undefined;

  // Retry-After is in seconds
  const seconds = parseFloat(value);
  return isNaN(seconds) ? undefined : seconds * 1000;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === opts.maxRetries || !isRetryable(error)) {
        throw error;
      }

      // Calculate exponential backoff with jitter
      const expDelay = Math.min(opts.baseDelayMs * Math.pow(2, attempt), opts.maxDelayMs);
      const jitteredDelay = expDelay * (0.5 + Math.random() * 0.5);

      // Use Retry-After header if present (server knows best)
      const retryAfterMs = extractRetryAfter(error);
      const delay = retryAfterMs ? Math.max(retryAfterMs, jitteredDelay) : jitteredDelay;

      await sleep(delay);
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error("Retry exhausted");
}
