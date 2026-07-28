export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  consume(): boolean {
    if (this.capacity <= 0 || this.refillPerSecond <= 0) {
      return true;
    }

    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillMs) / 1000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSeconds * this.refillPerSecond,
    );
    this.lastRefillMs = now;

    if (this.tokens < 1) {
      return false;
    }

    this.tokens -= 1;
    return true;
  }
}
