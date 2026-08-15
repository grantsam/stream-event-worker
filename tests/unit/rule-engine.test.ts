import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryIdempotencyStore } from '../../src/domain/idempotency/in-memory-idempotency-store.js';
import { PatternMatcher } from '../../src/domain/rules/pattern-matcher.js';
import { RuleEngine } from '../../src/domain/rules/rule-engine.js';
import { ScheduleMatcher } from '../../src/domain/rules/schedule-matcher.js';
import { InMemoryOpenBookSessionManager } from '../../src/domain/session/open-book-session-manager.js';
import { LatencyRecorder } from '../../src/infrastructure/metrics/latency-recorder.js';
import { fixtures, message, NOW } from '../fixtures/messages.js';

function engine(
  now = NOW,
  windows = [{ days: [2], startMinutes: 0, endMinutes: 1439 }],
) {
  return new RuleEngine(
    {
      targetThreadId: 'thread-test-001',
      authorizedSenderIds: ['admin-test-001'],
      maxEventAgeMs: 10_000,
      cooldownMs: 300_000,
      dedupeTtlMs: 300_000,
    },
    { nowEpochMs: () => now },
    new PatternMatcher(['open book', 'books open']),
    new ScheduleMatcher('Asia/Jakarta', windows),
    new InMemoryIdempotencyStore(),
    new InMemoryOpenBookSessionManager(),
  );
}

const evaluate = (subject: RuleEngine, event = fixtures.valid) =>
  subject.evaluate(event, new LatencyRecorder());

describe('rule engine', () => {
  let subject: RuleEngine;
  beforeEach(() => {
    subject = engine();
  });

  it('matches valid exact triggers after normalization', () => {
    expect(evaluate(subject)).toMatchObject({ decision: 'MATCH' });
    expect(evaluate(engine(), fixtures.uppercasePunctuation)).toMatchObject({
      decision: 'MATCH',
    });
    expect(evaluate(engine(), fixtures.secondTrigger)).toMatchObject({
      decision: 'MATCH',
    });
  });

  it.each([
    [fixtures.negativePhrase, 'NO_MATCH', 'trigger_not_matched'],
    [fixtures.wrongSender, 'NO_MATCH', 'unauthorized_sender'],
    [fixtures.wrongThread, 'NO_MATCH', 'wrong_thread'],
    [fixtures.stale, 'STALE_EVENT', 'event_age_invalid'],
  ])('rejects negative fixture %#', (event, decision, reasonCode) => {
    expect(evaluate(subject, event)).toMatchObject({ decision, reasonCode });
  });

  it('rejects events outside the active schedule', () => {
    expect(
      evaluate(engine(NOW, [{ days: [1], startMinutes: 0, endMinutes: 1 }])),
    ).toMatchObject({ decision: 'OUTSIDE_WINDOW' });
  });

  it('deduplicates before cooldown', () => {
    expect(evaluate(subject).decision).toBe('MATCH');
    expect(evaluate(subject).decision).toBe('DUPLICATE');
    expect(evaluate(subject, message({ eventId: 'event-new' }))).toMatchObject({
      decision: 'NO_MATCH',
      reasonCode: 'cooldown_active',
    });
  });
});
