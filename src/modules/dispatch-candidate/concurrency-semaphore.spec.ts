import { ConcurrencySemaphore } from './concurrency-semaphore';

describe('ConcurrencySemaphore', () => {
  it('allows up to maxConcurrency simultaneous holders', async () => {
    const semaphore = new ConcurrencySemaphore(2);
    let active = 0;
    let maxActive = 0;

    const work = async () => {
      const release = await semaphore.acquire();
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      release();
    };

    await Promise.all([work(), work(), work()]);

    expect(maxActive).toBe(2);
    expect(active).toBe(0);
  });

  it('is a no-op when maxConcurrency is zero or negative', async () => {
    const semaphore = new ConcurrencySemaphore(0);
    const release = await semaphore.acquire();
    expect(typeof release).toBe('function');
    release();
  });
});
