import type {
  DispatchStatus,
  RuleDecision,
} from '../../domain/events/dispatch-result.js';
import type { LatencyMetrics } from './latency-recorder.js';

export interface RuntimeMetricsSnapshot {
  uptimeMs: number;
  eventsReceived: number;
  eventsProcessed: number;
  inFlight: number;
  processingExceptions: number;
  failedDispatches: number;
  missingLatency: number;
  decisions: Record<RuleDecision, number>;
  statuses: Record<DispatchStatus, number>;
  reasons: Record<string, number>;
  latency: Record<string, LatencyAggregate>;
  lastSuccessEpochMs: number | null;
  lastFailureEpochMs: number | null;
}

interface LatencyAggregate {
  count: number;
  sumMs: number;
  minMs: number | null;
  maxMs: number | null;
}

export class RuntimeMetrics {
  private readonly startedAtEpochMs = Date.now();
  private eventsReceived = 0;
  private eventsProcessed = 0;
  private inFlight = 0;
  private processingExceptions = 0;
  private failedDispatches = 0;
  private missingLatency = 0;
  private lastSuccessEpochMs: number | null = null;
  private lastFailureEpochMs: number | null = null;
  private readonly decisions = emptyDecisions();
  private readonly statuses = emptyStatuses();
  private readonly reasons: Record<string, number> = {};
  private readonly latency = {
    receiveToMatch: emptyLatency(),
    matchToDispatch: emptyLatency(),
    receiveToDispatch: emptyLatency(),
  };

  startProcessing(): void {
    this.eventsReceived += 1;
    this.inFlight += 1;
  }

  finishProcessing(
    decision: RuleDecision,
    status: DispatchStatus,
    reasonCode: string,
    latency: LatencyMetrics,
  ): void {
    this.eventsProcessed += 1;
    this.inFlight -= 1;
    this.decisions[decision] += 1;
    this.statuses[status] += 1;
    this.reasons[reasonCode] = (this.reasons[reasonCode] ?? 0) + 1;
    if (status === 'FAILED') this.failedDispatches += 1;
    if (
      latency.receive_to_match_ms === undefined ||
      latency.match_to_dispatch_ms === undefined ||
      latency.receive_to_dispatch_ms === undefined
    ) {
      this.missingLatency += 1;
    }
    recordLatency(this.latency.receiveToMatch, latency.receive_to_match_ms);
    recordLatency(this.latency.matchToDispatch, latency.match_to_dispatch_ms);
    recordLatency(
      this.latency.receiveToDispatch,
      latency.receive_to_dispatch_ms,
    );
    if (status === 'FAILED') this.lastFailureEpochMs = Date.now();
    else this.lastSuccessEpochMs = Date.now();
  }

  failProcessing(): void {
    this.eventsProcessed += 1;
    this.inFlight -= 1;
    this.processingExceptions += 1;
    this.lastFailureEpochMs = Date.now();
  }

  snapshot(): RuntimeMetricsSnapshot {
    return {
      uptimeMs: Date.now() - this.startedAtEpochMs,
      eventsReceived: this.eventsReceived,
      eventsProcessed: this.eventsProcessed,
      inFlight: this.inFlight,
      processingExceptions: this.processingExceptions,
      failedDispatches: this.failedDispatches,
      missingLatency: this.missingLatency,
      decisions: { ...this.decisions },
      statuses: { ...this.statuses },
      reasons: { ...this.reasons },
      latency: {
        receiveToMatch: { ...this.latency.receiveToMatch },
        matchToDispatch: { ...this.latency.matchToDispatch },
        receiveToDispatch: { ...this.latency.receiveToDispatch },
      },
      lastSuccessEpochMs: this.lastSuccessEpochMs,
      lastFailureEpochMs: this.lastFailureEpochMs,
    };
  }
}

function emptyLatency(): LatencyAggregate {
  return { count: 0, sumMs: 0, minMs: null, maxMs: null };
}

function recordLatency(
  target: LatencyAggregate,
  value: number | undefined,
): void {
  if (value === undefined) return;
  target.count += 1;
  target.sumMs += value;
  target.minMs = target.minMs === null ? value : Math.min(target.minMs, value);
  target.maxMs = target.maxMs === null ? value : Math.max(target.maxMs, value);
}

function emptyDecisions(): Record<RuleDecision, number> {
  return {
    MATCH: 0,
    NO_MATCH: 0,
    DUPLICATE: 0,
    OUTSIDE_WINDOW: 0,
    STALE_EVENT: 0,
    INSUFFICIENT_DATA: 0,
  };
}

function emptyStatuses(): Record<DispatchStatus, number> {
  return { DRY_RUN_DISPATCHED: 0, IGNORED: 0, FAILED: 0 };
}
