export const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
] as const;

export const PAYMENT_FAILURE_CODES = [
  'provider_declined',
  'processing_error',
  'processing_timeout',
  'attempts_exhausted',
  'cancelled_by_operator',
] as const;

export const PAYMENT_TRANSITION_ACTORS = ['worker', 'operator'] as const;
