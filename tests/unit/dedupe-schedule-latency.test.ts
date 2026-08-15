import { describe, expect, it } from 'vitest';
import { createFingerprint } from '../../src/domain/idempotency/idempotency-store.js';
import { InMemoryIdempotencyStore } from '../../src/domain/idempotency/in-memory-idempotency-store.js';
import { ScheduleMatcher } from '../../src/domain/rules/schedule-matcher.js';
import { LatencyRecorder } from '../../src/infrastructure/metrics/latency-recorder.js';

const fingerprintInput = {
  eventId: 'event-test-001',
  threadId: 'thread-test-001',
  senderId: 'admin-test-001',
  normalizedBody: 'open book',
  sourceTimestampEpochMs: 1_000,
};

describe('dedupe, schedule, and latency', () => {
  it('creates deterministic fingerprints and atomically claims within TTL', () => {
    const fingerprint = createFingerprint(fingerprintInput);
    expect(fingerprint).toBe(createFingerprint(fingerprintInput));
    const store = new InMemoryIdempotencyStore();
    expect(store.claim(fingerprint, 1_000, 100)).toBe(true);
    expect(store.claim(fingerprint, 1_050, 100)).toBe(false);
    expect(store.claim(fingerprint, 1_100, 100)).toBe(true);
  });

  it('periodically removes expired fingerprints', () => {
    const store = new InMemoryIdempotencyStore();
    for (let index = 0; index < 1_024; index += 1) {
      expect(store.claim(`fingerprint-${index}`, index, 1)).toBe(true);
    }
    expect(store.claim('fingerprint-0', 1_024, 1)).toBe(true);
  });

  it('matches Jakarta windows and rejects outside schedule', () => {
    const matcher = new ScheduleMatcher('Asia/Jakarta', [
      { days: [2], startMinutes: 11 * 60, endMinutes: 13 * 60 },
    ]);
    expect(matcher.matches(Date.parse('2026-08-04T05:00:00Z'))).toBe(true);
    expect(matcher.matches(Date.parse('2026-08-04T08:00:00Z'))).toBe(false);
  });

  it('supports overnight active windows on both calendar days', () => {
    const matcher = new ScheduleMatcher('Asia/Jakarta', [
      { days: [2], startMinutes: 23 * 60, endMinutes: 60 },
    ]);
    expect(matcher.matches(Date.parse('2026-08-04T16:30:00Z'))).toBe(true);
    expect(matcher.matches(Date.parse('2026-08-04T17:30:00Z'))).toBe(true);
  });

  it('calculates only available monotonic latency spans', () => {
    const latency = new LatencyRecorder();
    latency.mark('event_received', 1_000_000n);
    latency.mark('rule_match_completed', 3_000_000n);
    latency.mark('dispatch_started', 4_000_000n);
    latency.mark('dispatch_completed', 6_000_000n);
    expect(latency.metrics()).toEqual({
      receive_to_match_ms: 2,
      match_to_dispatch_ms: 1,
      receive_to_dispatch_ms: 5,
    });
  });
});
