import { TokenBucket } from './token-bucket';

describe('TokenBucket', () => {
  it('allows consumption up to capacity', () => {
    const bucket = new TokenBucket(3, 10);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(false);
  });

  it('refills tokens over time', async () => {
    const bucket = new TokenBucket(1, 100);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(bucket.consume()).toBe(true);
  });

  it('is always open when capacity or refill rate is zero', () => {
    const bucket = new TokenBucket(0, 10);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(true);
  });
});
