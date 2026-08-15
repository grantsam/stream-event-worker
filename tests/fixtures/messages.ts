import type { IncomingMessage } from '../../src/domain/events/incoming-message.js';

export const NOW = Date.parse('2026-08-04T05:00:00.000Z'); // Tuesday noon in Jakarta.

export function message(
  overrides: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    eventId: 'event-test-001',
    threadId: 'thread-test-001',
    senderId: 'admin-test-001',
    body: 'open book',
    receivedAtEpochMs: NOW,
    sourceTimestampEpochMs: NOW,
    ...overrides,
  };
}

export const fixtures = {
  valid: message(),
  uppercasePunctuation: message({
    eventId: 'event-test-002',
    body: 'OPEN BOOK!!!',
  }),
  wrongSender: message({
    eventId: 'event-test-003',
    senderId: 'sender-test-other',
  }),
  wrongThread: message({
    eventId: 'event-test-004',
    threadId: 'thread-test-other',
  }),
  stale: message({
    eventId: 'event-test-005',
    sourceTimestampEpochMs: NOW - 10_001,
  }),
  negativePhrase: message({
    eventId: 'event-test-006',
    body: 'belum open book',
  }),
  secondTrigger: message({ eventId: 'event-test-007', body: 'books open' }),
};
