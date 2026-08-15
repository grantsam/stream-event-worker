import { describe, expect, it } from 'vitest';
import { RuntimeMetrics } from '../../src/infrastructure/metrics/runtime-metrics.js';

describe('RuntimeMetrics', () => {
  it('records only bounded allowlisted operational data', () => {
    const metrics = new RuntimeMetrics();
    metrics.startProcessing();
    metrics.finishProcessing('MATCH', 'DRY_RUN_DISPATCHED', 'trigger_matched', {
      receive_to_match_ms: 1,
      match_to_dispatch_ms: 2,
      receive_to_dispatch_ms: 3,
    });
    const snapshot = metrics.snapshot();
    expect(snapshot).toMatchObject({
      eventsReceived: 1,
      eventsProcessed: 1,
      inFlight: 0,
      decisions: { MATCH: 1 },
      statuses: { DRY_RUN_DISPATCHED: 1 },
      reasons: { trigger_matched: 1 },
    });
    expect(JSON.stringify(snapshot)).not.toContain('open book');
    snapshot.decisions.MATCH = 99;
    expect(metrics.snapshot().decisions.MATCH).toBe(1);
  });

  it('returns in-flight processing to zero after exceptions', () => {
    const metrics = new RuntimeMetrics();
    metrics.startProcessing();
    metrics.failProcessing();
    expect(metrics.snapshot()).toMatchObject({
      eventsProcessed: 1,
      inFlight: 0,
      processingExceptions: 1,
    });
  });
});
