export const DRIVER_OPERATIONAL_STATES = [
  'offline',
  'online',
  'offered',
  'assigned',
  'suspended',
] as const;

export type DriverOperationalState = (typeof DRIVER_OPERATIONAL_STATES)[number];

const allowedTransitions = {
  offline: ['online', 'suspended'],
  online: ['offline', 'offered', 'suspended'],
  offered: ['online', 'assigned', 'suspended'],
  assigned: ['offline', 'online', 'suspended'],
  suspended: ['offline'],
} satisfies Record<DriverOperationalState, readonly DriverOperationalState[]>;

export const canTransitionDriverOperationalState = (
  from: DriverOperationalState,
  to: DriverOperationalState,
) =>
  (allowedTransitions[from] as readonly DriverOperationalState[]).includes(to);

export const assertDriverOperationalTransition = (
  from: DriverOperationalState,
  to: DriverOperationalState,
) => {
  if (!canTransitionDriverOperationalState(from, to)) {
    throw new Error(`invalid driver operational transition: ${from} -> ${to}`);
  }
};
