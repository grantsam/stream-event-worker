export type LatencyStage =
  | 'event_received'
  | 'validation_started'
  | 'rule_match_completed'
  | 'dedupe_completed'
  | 'dispatch_started'
  | 'dispatch_completed';

export interface LatencyMetrics {
  receive_to_match_ms?: number;
  match_to_dispatch_ms?: number;
  receive_to_dispatch_ms?: number;
}

export class LatencyRecorder {
  private readonly timestamps = new Map<LatencyStage, bigint>();

  mark(stage: LatencyStage, timestamp = process.hrtime.bigint()): void {
    this.timestamps.set(stage, timestamp);
  }

  has(stage: LatencyStage): boolean {
    return this.timestamps.has(stage);
  }

  metrics(): LatencyMetrics {
    const received = this.timestamps.get('event_received');
    const matched = this.timestamps.get('rule_match_completed');
    const dispatchStarted = this.timestamps.get('dispatch_started');
    const dispatchCompleted = this.timestamps.get('dispatch_completed');
    const result: LatencyMetrics = {};
    if (received !== undefined && matched !== undefined) {
      result.receive_to_match_ms = milliseconds(received, matched);
    }
    if (matched !== undefined && dispatchStarted !== undefined) {
      result.match_to_dispatch_ms = milliseconds(matched, dispatchStarted);
    }
    if (received !== undefined && dispatchCompleted !== undefined) {
      result.receive_to_dispatch_ms = milliseconds(received, dispatchCompleted);
    }
    return result;
  }
}

function milliseconds(start: bigint, end: bigint): number {
  return Number(end - start) / 1_000_000;
}
