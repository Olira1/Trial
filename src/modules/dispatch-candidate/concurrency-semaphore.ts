export class ConcurrencySemaphore {
  private running = 0;
  private readonly queue: Array<(release: () => void) => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async acquire(): Promise<() => void> {
    if (this.maxConcurrency <= 0) {
      return () => {};
    }

    if (this.running < this.maxConcurrency) {
      this.running += 1;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.queue.push((release) => resolve(release));
    });
  }

  private release(): void {
    this.running -= 1;
    const next = this.queue.shift();
    if (next) {
      this.running += 1;
      next(() => this.release());
    }
  }
}
