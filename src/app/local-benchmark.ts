import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { MockMessengerTransport } from '../adapters/messenger/mock-messenger-transport.js';
import type {
  DispatchStatus,
  RuleDecision,
} from '../domain/events/dispatch-result.js';
import type { IncomingMessage } from '../domain/events/incoming-message.js';
import type { Clock } from '../infrastructure/clock/clock.js';
import { loadConfig } from '../infrastructure/config/env.js';
import { createLogger } from '../infrastructure/logging/logger.js';
import {
  LatencyRecorder,
  type LatencyMetrics,
} from '../infrastructure/metrics/latency-recorder.js';
import { bootstrap } from './bootstrap.js';

export type PerformanceCommand =
  { mode: 'benchmark'; events: number } | { mode: 'soak'; durationMs: number };

interface Percentiles {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface PerformanceSummary {
  mode: 'benchmark' | 'soak';
  requested: { events: number } | { durationMs: number };
  generatedEvents: number;
  processedEvents: number;
  dispatches: number;
  durationMs: number;
  throughputEventsPerSecond: number;
  aborted: boolean;
  memoryBytes: {
    rss: { start: number; end: number; peak: number };
    heapUsed: { start: number; end: number; peak: number };
  };
  latencyMs: {
    worker: Percentiles;
    receiveToMatch: Percentiles;
    matchToDispatch: Percentiles;
    receiveToDispatch: Percentiles;
  };
  counts: {
    decision: Record<RuleDecision, number>;
    status: Record<DispatchStatus, number>;
    correctness: { passed: number; failed: number };
    gaps: number;
    errors: {
      total: number;
      processingExceptions: number;
      failedDispatches: number;
      invalidResults: number;
      missingLatency: number;
    };
  };
  scope: 'local_worker_mock_transport_only';
  messengerE2e: false;
}

export class MutableEpochClock implements Clock {
  constructor(private now: number) {}

  nowEpochMs(): number {
    return this.now;
  }

  advance(milliseconds: number): void {
    this.now += milliseconds;
  }
}

export function parsePerformanceArgs(
  args: readonly string[],
): PerformanceCommand {
  if (
    args.length === 3 &&
    args[0] === '--benchmark' &&
    args[1] === '--events'
  ) {
    return {
      mode: 'benchmark',
      events: parsePositiveInteger(args[2], 'events'),
    };
  }
  if (args.length === 3 && args[0] === '--soak' && args[1] === '--duration') {
    return { mode: 'soak', durationMs: parseDuration(args[2]) };
  }
  throw new Error(
    'Usage: open-book-event-worker (--benchmark --events <count> | --soak --duration <Nms|Ns|Nm|Nh>)',
  );
}

export function parseDuration(value: string | undefined): number {
  const match = /^(\d+)(ms|s|m|h)$/u.exec(value ?? '');
  if (!match)
    throw new Error(
      'duration must be a positive integer followed by ms, s, m, or h',
    );
  const amount = parsePositiveInteger(match[1], 'duration');
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[
    match[2] as 'ms' | 's' | 'm' | 'h'
  ];
  const durationMs = amount * multiplier;
  if (!Number.isSafeInteger(durationMs))
    throw new Error('duration is too large');
  return durationMs;
}

export function calculatePercentiles(samples: readonly number[]): Percentiles {
  const sorted = samples
    .filter(Number.isFinite)
    .toSorted((left, right) => left - right);
  return {
    count: sorted.length,
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    p99: nearestRank(sorted, 0.99),
  };
}

export function createSyntheticEvent(
  sequence: number,
  nowEpochMs: number,
): IncomingMessage {
  return {
    eventId: `local-benchmark-${sequence}`,
    threadId: 'thread-test-001',
    senderId: 'admin-test-001',
    body: 'open book',
    receivedAtEpochMs: nowEpochMs,
    sourceTimestampEpochMs: nowEpochMs,
  };
}

export async function runPerformanceHarness(
  command: PerformanceCommand,
  signal?: AbortSignal,
): Promise<PerformanceSummary> {
  const cooldownMs = 1;
  const clock = new MutableEpochClock(Date.now());
  const transport = new MockMessengerTransport();
  const config = loadConfig({
    NODE_ENV: 'development',
    APP_MODE: 'dry-run',
    LOG_LEVEL: 'silent',
    TRANSPORT_ADAPTER: 'mock',
    TIMEZONE: 'Asia/Jakarta',
    TARGET_THREAD_ID: 'thread-test-001',
    AUTHORIZED_SENDER_IDS: 'admin-test-001',
    TRIGGER_PHRASES: 'open book',
    RESPONSE_TEXT: 'Me down',
    ACTIVE_WINDOWS: 'MON-SUN@00:00-23:59',
    COOLDOWN_MS: String(cooldownMs),
    MAX_EVENT_AGE_MS: '10000',
    HEALTH_HOST: '127.0.0.1',
    HEALTH_PORT: '0',
  });
  const app = await bootstrap({
    config,
    clock,
    transport,
    logger: createLogger('silent'),
    stateMode: 'ephemeral',
  });
  const samples = {
    worker: [] as number[],
    receiveToMatch: [] as number[],
    matchToDispatch: [] as number[],
    receiveToDispatch: [] as number[],
  };
  const decision = emptyDecisionCounts();
  const status = emptyStatusCounts();
  const errors = {
    total: 0,
    processingExceptions: 0,
    failedDispatches: 0,
    invalidResults: 0,
    missingLatency: 0,
  };
  let generatedEvents = 0;
  let processedEvents = 0;
  let dispatches = 0;
  let passed = 0;
  let failed = 0;
  let gaps = 0;
  const memoryStart = process.memoryUsage();
  let peakRss = memoryStart.rss;
  let peakHeapUsed = memoryStart.heapUsed;
  const started = process.hrtime.bigint();
  const deadline =
    command.mode === 'soak'
      ? started + BigInt(command.durationMs) * 1_000_000n
      : undefined;

  try {
    while (
      !signal?.aborted &&
      (command.mode === 'benchmark'
        ? generatedEvents < command.events
        : process.hrtime.bigint() < deadline!)
    ) {
      const sequence = generatedEvents + 1;
      const event = createSyntheticEvent(sequence, clock.nowEpochMs());
      generatedEvents += 1;
      const latency = new LatencyRecorder();
      const eventStarted = process.hrtime.bigint();
      const dispatchesBefore = transport.dispatches.length;
      let eventPassed = true;
      try {
        const result = await app.process(event, latency);
        samples.worker.push(
          elapsedMilliseconds(eventStarted, process.hrtime.bigint()),
        );
        processedEvents += 1;
        decision[result.decision] += 1;
        status[result.status] += 1;
        const newDispatches = transport.dispatches.length - dispatchesBefore;
        dispatches += newDispatches;
        const metrics = latency.metrics();
        collectMetrics(samples, metrics);
        if (
          result.eventId !== event.eventId ||
          result.decision !== 'MATCH' ||
          result.reasonCode !== 'trigger_matched' ||
          result.status !== 'DRY_RUN_DISPATCHED' ||
          newDispatches !== 1
        ) {
          eventPassed = false;
          errors.invalidResults += 1;
        }
        if (result.status === 'FAILED') errors.failedDispatches += 1;
        if (!hasAllMetrics(metrics)) {
          eventPassed = false;
          errors.missingLatency += 1;
        }
      } catch {
        samples.worker.push(
          elapsedMilliseconds(eventStarted, process.hrtime.bigint()),
        );
        processedEvents += 1;
        eventPassed = false;
        gaps += 1;
        errors.processingExceptions += 1;
      }
      transport.dispatches.length = 0;
      if (eventPassed) passed += 1;
      else failed += 1;
      clock.advance(cooldownMs + 1);
      const memory = process.memoryUsage();
      peakRss = Math.max(peakRss, memory.rss);
      peakHeapUsed = Math.max(peakHeapUsed, memory.heapUsed);
      if (generatedEvents % 256 === 0) await yieldToEventLoop();
    }
  } finally {
    await app.shutdown();
  }

  errors.total =
    errors.processingExceptions +
    errors.failedDispatches +
    errors.invalidResults +
    errors.missingLatency;
  const ended = process.hrtime.bigint();
  const durationMs = elapsedMilliseconds(started, ended);
  const memoryEnd = process.memoryUsage();
  peakRss = Math.max(peakRss, memoryEnd.rss);
  peakHeapUsed = Math.max(peakHeapUsed, memoryEnd.heapUsed);
  gaps += Math.max(0, generatedEvents - processedEvents);

  return {
    mode: command.mode,
    requested:
      command.mode === 'benchmark'
        ? { events: command.events }
        : { durationMs: command.durationMs },
    generatedEvents,
    processedEvents,
    dispatches,
    durationMs,
    throughputEventsPerSecond:
      durationMs === 0 ? 0 : processedEvents / (durationMs / 1_000),
    aborted: signal?.aborted ?? false,
    memoryBytes: {
      rss: { start: memoryStart.rss, end: memoryEnd.rss, peak: peakRss },
      heapUsed: {
        start: memoryStart.heapUsed,
        end: memoryEnd.heapUsed,
        peak: peakHeapUsed,
      },
    },
    latencyMs: {
      worker: calculatePercentiles(samples.worker),
      receiveToMatch: calculatePercentiles(samples.receiveToMatch),
      matchToDispatch: calculatePercentiles(samples.matchToDispatch),
      receiveToDispatch: calculatePercentiles(samples.receiveToDispatch),
    },
    counts: {
      decision,
      status,
      correctness: { passed, failed },
      gaps,
      errors,
    },
    scope: 'local_worker_mock_transport_only',
    messengerE2e: false,
  };
}

function parsePositiveInteger(value: string | undefined, name: string): number {
  if (!/^[1-9]\d*$/u.test(value ?? ''))
    throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large`);
  return parsed;
}

function nearestRank(
  sorted: readonly number[],
  percentile: number,
): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(sorted.length * percentile) - 1] ?? null;
}

function elapsedMilliseconds(start: bigint, end: bigint): number {
  return Number(end - start) / 1_000_000;
}

function collectMetrics(
  samples: {
    receiveToMatch: number[];
    matchToDispatch: number[];
    receiveToDispatch: number[];
  },
  metrics: LatencyMetrics,
): void {
  if (metrics.receive_to_match_ms !== undefined)
    samples.receiveToMatch.push(metrics.receive_to_match_ms);
  if (metrics.match_to_dispatch_ms !== undefined)
    samples.matchToDispatch.push(metrics.match_to_dispatch_ms);
  if (metrics.receive_to_dispatch_ms !== undefined)
    samples.receiveToDispatch.push(metrics.receive_to_dispatch_ms);
}

function hasAllMetrics(metrics: LatencyMetrics): boolean {
  return (
    metrics.receive_to_match_ms !== undefined &&
    metrics.match_to_dispatch_ms !== undefined &&
    metrics.receive_to_dispatch_ms !== undefined
  );
}

function emptyDecisionCounts(): Record<RuleDecision, number> {
  return {
    MATCH: 0,
    NO_MATCH: 0,
    DUPLICATE: 0,
    OUTSIDE_WINDOW: 0,
    STALE_EVENT: 0,
    INSUFFICIENT_DATA: 0,
  };
}

function emptyStatusCounts(): Record<DispatchStatus, number> {
  return { DRY_RUN_DISPATCHED: 0, IGNORED: 0, FAILED: 0 };
}
