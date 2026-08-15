export type RuleDecision =
  | 'MATCH'
  | 'NO_MATCH'
  | 'DUPLICATE'
  | 'OUTSIDE_WINDOW'
  | 'STALE_EVENT'
  | 'INSUFFICIENT_DATA';

export type DispatchStatus = 'DRY_RUN_DISPATCHED' | 'IGNORED' | 'FAILED';

export interface DispatchResult {
  eventId: string;
  decision: RuleDecision;
  reasonCode: string;
  status: DispatchStatus;
  error?: string;
}
