export const DISPATCH_CANCELLATION_REASON_CODES = [
  'generic',
  'wrong_pickup',
  'rider_changed_mind',
  'driver_delay',
  'driver_requested',
  'driver_emergency',
  'driver_no_show',
  'rider_no_show',
  'other',
] as const;

export type DispatchCancellationReasonCode =
  (typeof DISPATCH_CANCELLATION_REASON_CODES)[number];

export type DispatchCancellationActorRole = 'rider' | 'driver' | 'system';

export type DispatchCancellationInput = {
  reasonCode?: DispatchCancellationReasonCode;
  notes?: string | null;
};
