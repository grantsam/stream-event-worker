import { createHash } from 'node:crypto';
import type { IncomingMessage } from '../events/incoming-message.js';

export interface IdempotencyStore {
  claim(fingerprint: string, nowEpochMs: number, ttlMs: number): boolean;
}

export interface FingerprintInput extends Pick<
  IncomingMessage,
  'eventId' | 'threadId' | 'senderId' | 'sourceTimestampEpochMs'
> {
  normalizedBody: string;
}

export function createFingerprint(input: FingerprintInput): string {
  const framed = [
    input.eventId,
    input.threadId,
    input.senderId,
    input.normalizedBody,
    String(input.sourceTimestampEpochMs),
  ]
    .map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`)
    .join('|');

  return createHash('sha256').update(framed).digest('hex');
}
