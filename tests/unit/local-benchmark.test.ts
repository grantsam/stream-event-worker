import { describe, expect, it } from 'vitest';
import {
  calculatePercentiles,
  createSyntheticEvent,
  MutableEpochClock,
  parseDuration,
  parsePerformanceArgs,
  runPerformanceHarness,
} from '../../src/app/local-benchmark.js';

describe('local benchmark harness', () => {
  it('strictly parses benchmark and soak commands', () => {
    expect(parsePerformanceArgs(['--benchmark', '--events', '3'])).toEqual({
      mode: 'benchmark',
      events: 3,
    });
    expect(parsePerformanceArgs(['--soak', '--duration', '2s'])).toEqual({
      mode: 'soak',
      durationMs: 2_000,
    });
    expect(parseDuration('1ms')).toBe(1);
    expect(parseDuration('2m')).toBe(120_000);
    expect(parseDuration('1h')).toBe(3_600_000);
  });

  it.each([
    ['--benchmark', '--events', '0'],
    ['--benchmark', '--events', '-1'],
    ['--benchmark', '--events', '1.5'],
    ['--benchmark', '--events', '1e3'],
    ['--soak', '--duration', '0ms'],
    ['--soak', '--duration', '1'],
    ['--soak', '--duration', '-1s'],
    ['--unknown', '--events', '1'],
  ])('rejects invalid command %#', (...args) => {
    expect(() => parsePerformanceArgs(args)).toThrow();
  });

  it('calculates exact nearest-rank percentiles and empty samples', () => {
    expect(calculatePercentiles([])).toEqual({
      count: 0,
      p50: null,
      p95: null,
      p99: null,
    });
    expect(calculatePercentiles([5, 1, 4, 2, 3])).toEqual({
      count: 5,
      p50: 3,
      p95: 5,
      p99: 5,
    });
  });

  it('generates unique synthetic events and advances epoch time', () => {
    const clock = new MutableEpochClock(1_000);
    expect(createSyntheticEvent(1, clock.nowEpochMs())).toMatchObject({
      eventId: 'local-benchmark-1',
      sourceTimestampEpochMs: 1_000,
    });
    clock.advance(2);
    expect(createSyntheticEvent(2, clock.nowEpochMs())).toMatchObject({
      eventId: 'local-benchmark-2',
      sourceTimestampEpochMs: 1_002,
    });
  });

  it('runs a small benchmark with complete metrics and correctness', async () => {
    const summary = await runPerformanceHarness({
      mode: 'benchmark',
      events: 3,
    });
    expect(summary).toMatchObject({
      mode: 'benchmark',
      requested: { events: 3 },
      generatedEvents: 3,
      processedEvents: 3,
      dispatches: 3,
      aborted: false,
      counts: {
        decision: { MATCH: 3 },
        status: { DRY_RUN_DISPATCHED: 3 },
        correctness: { passed: 3, failed: 0 },
        gaps: 0,
        errors: { total: 0 },
      },
      scope: 'local_worker_mock_transport_only',
      messengerE2e: false,
    });
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(summary.latencyMs.worker.count).toBe(3);
    expect(summary.latencyMs.receiveToMatch.count).toBe(3);
    expect(summary.latencyMs.matchToDispatch.count).toBe(3);
    expect(summary.latencyMs.receiveToDispatch.count).toBe(3);
    expect(summary.memoryBytes.rss.peak).toBeGreaterThanOrEqual(
      summary.memoryBytes.rss.start,
    );
    expect(summary.memoryBytes.heapUsed.peak).toBeGreaterThanOrEqual(
      summary.memoryBytes.heapUsed.end,
    );
  });

  it('returns an aborted soak summary without processing', async () => {
    const controller = new AbortController();
    controller.abort();
    const summary = await runPerformanceHarness(
      { mode: 'soak', durationMs: 1 },
      controller.signal,
    );
    expect(summary).toMatchObject({
      mode: 'soak',
      generatedEvents: 0,
      processedEvents: 0,
      dispatches: 0,
      aborted: true,
    });
  });
});
