/**
 * A token-bucket rate limiter. Tokens refill continuously at `ratePerSecond`,
 * up to `capacity`. `acquire()` resolves once a token is available, waiting
 * if necessary - callers naturally get throttled to the target rate rather
 * than firing all at once.
 *
 * `acquire()` calls are serialized through an internal queue so concurrent
 * callers (e.g. several backfill requests in flight at once) still get
 * correct token accounting instead of racing each other and overshooting
 * the rate.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ratePerSecond: number,
    private readonly capacity: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.ratePerSecond);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    this.refill();
    if (this.tokens < 1) {
      const waitMs = ((1 - this.tokens) / this.ratePerSecond) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.refill();
    }
    this.tokens -= 1;

    release();
  }
}
