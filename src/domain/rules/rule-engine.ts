import type { RuleDecision } from '../events/dispatch-result.js';
import type { IncomingMessage } from '../events/incoming-message.js';
import {
  createFingerprint,
  type IdempotencyStore,
} from '../idempotency/idempotency-store.js';
import type { OpenBookSessionManager } from '../session/open-book-session-manager.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { LatencyRecorder } from '../../infrastructure/metrics/latency-recorder.js';
import { normalizeMessage } from './message-normalizer.js';
import type { PatternMatcher } from './pattern-matcher.js';
import type { ScheduleMatcher } from './schedule-matcher.js';

export interface RuleOutcome {
  decision: RuleDecision;
  reasonCode: string;
  normalizedBody?: string;
}

interface RuleEngineOptions {
  targetThreadId: string;
  authorizedSenderIds: readonly string[];
  maxEventAgeMs: number;
  cooldownMs: number;
  dedupeTtlMs: number;
}

export class RuleEngine {
  private readonly authorizedSenderIds: ReadonlySet<string>;

  constructor(
    private readonly options: RuleEngineOptions,
    private readonly clock: Clock,
    private readonly patternMatcher: PatternMatcher,
    private readonly scheduleMatcher: ScheduleMatcher,
    private readonly idempotencyStore: IdempotencyStore,
    private readonly sessions: OpenBookSessionManager,
  ) {
    this.authorizedSenderIds = new Set(options.authorizedSenderIds);
  }

  evaluate(event: IncomingMessage, latency: LatencyRecorder): RuleOutcome {
    latency.mark('validation_started');
    if (!hasMetadata(event))
      return outcome('INSUFFICIENT_DATA', 'missing_metadata', latency);
    if (event.threadId !== this.options.targetThreadId)
      return outcome('NO_MATCH', 'wrong_thread', latency);
    if (!this.authorizedSenderIds.has(event.senderId))
      return outcome('NO_MATCH', 'unauthorized_sender', latency);

    const now = this.clock.nowEpochMs();
    const age = now - event.sourceTimestampEpochMs;
    if (age < -30_000 || age > this.options.maxEventAgeMs)
      return outcome('STALE_EVENT', 'event_age_invalid', latency);
    if (!this.scheduleMatcher.matches(event.sourceTimestampEpochMs))
      return outcome('OUTSIDE_WINDOW', 'outside_active_window', latency);

    const normalizedBody = normalizeMessage(event.body);
    if (!normalizedBody)
      return outcome('INSUFFICIENT_DATA', 'empty_body', latency);
    if (!this.patternMatcher.matches(normalizedBody))
      return outcome(
        'NO_MATCH',
        'trigger_not_matched',
        latency,
        normalizedBody,
      );

    latency.mark('rule_match_completed');
    const fingerprint = createFingerprint({
      eventId: event.eventId,
      threadId: event.threadId,
      senderId: event.senderId,
      normalizedBody,
      sourceTimestampEpochMs: event.sourceTimestampEpochMs,
    });
    if (
      !this.idempotencyStore.claim(fingerprint, now, this.options.dedupeTtlMs)
    ) {
      latency.mark('dedupe_completed');
      return {
        decision: 'DUPLICATE',
        reasonCode: 'duplicate_fingerprint',
        normalizedBody,
      };
    }
    latency.mark('dedupe_completed');
    if (!this.sessions.claim(event.threadId, now, this.options.cooldownMs)) {
      return {
        decision: 'NO_MATCH',
        reasonCode: 'cooldown_active',
        normalizedBody,
      };
    }
    return { decision: 'MATCH', reasonCode: 'trigger_matched', normalizedBody };
  }

  ready(): boolean {
    return (
      this.options.targetThreadId.length > 0 &&
      this.authorizedSenderIds.size > 0 &&
      this.scheduleMatcher.ready()
    );
  }
}

function outcome(
  decision: RuleDecision,
  reasonCode: string,
  latency: LatencyRecorder,
  normalizedBody?: string,
): RuleOutcome {
  latency.mark('rule_match_completed');
  return normalizedBody === undefined
    ? { decision, reasonCode }
    : { decision, reasonCode, normalizedBody };
}

function hasMetadata(event: IncomingMessage): boolean {
  return Boolean(
    event.eventId &&
    event.threadId &&
    event.senderId &&
    event.body &&
    Number.isFinite(event.receivedAtEpochMs) &&
    Number.isFinite(event.sourceTimestampEpochMs),
  );
}
