import {
  DRIVER_OPERATIONAL_STATES,
  assertDriverOperationalTransition,
  canTransitionDriverOperationalState,
} from './driver-operational-state';

describe('driver operational state transitions', () => {
  it('defines the approved durable operational states', () => {
    expect(DRIVER_OPERATIONAL_STATES).toEqual([
      'offline',
      'online',
      'offered',
      'assigned',
      'suspended',
    ]);
  });

  it.each([
    ['offline', 'online'],
    ['offline', 'suspended'],
    ['online', 'offline'],
    ['online', 'offered'],
    ['online', 'suspended'],
    ['offered', 'online'],
    ['offered', 'assigned'],
    ['offered', 'suspended'],
    ['assigned', 'offline'],
    ['assigned', 'online'],
    ['assigned', 'suspended'],
    ['suspended', 'offline'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionDriverOperationalState(from, to)).toBe(true);
    expect(() => assertDriverOperationalTransition(from, to)).not.toThrow();
  });

  it.each([
    ['offline', 'offered'],
    ['offline', 'assigned'],
    ['online', 'assigned'],
    ['offered', 'offline'],
    ['assigned', 'offered'],
    ['suspended', 'online'],
    ['suspended', 'offered'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransitionDriverOperationalState(from, to)).toBe(false);
    expect(() => assertDriverOperationalTransition(from, to)).toThrow(
      `invalid driver operational transition: ${from} -> ${to}`,
    );
  });
});
