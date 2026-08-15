import { describe, expect, it, vi } from 'vitest';
import { RaceTracker } from '../../src/domain/race/race-tracker.js';
import type { HitRecord } from '../../src/domain/events/hit-record.js';
import type { IncomingMessage } from '../../src/domain/events/incoming-message.js';

describe('RaceTracker', () => {
  it('tracks contenders and ranks our bot in the chat queue', () => {
    const tracker = new RaceTracker(1000);
    const hit: HitRecord = {
      id: 'hit-101',
      clientName: 'samuel_vip',
      timestamp: new Date().toISOString(),
      epochMs: Date.now() - 50,
      threadId: 'thread-test-race',
      senderId: 'admin-001',
      triggerPhrase: 'open book',
      responseText: 'Me down',
      reactionTimeMs: 14.5,
      status: 'SUCCESS',
    };

    const onFinalized = vi.fn();
    const initial = tracker.startRound(hit, onFinalized);
    expect(initial.ourRankInQueue).toBe(1);
    expect(initial.totalContenders).toBe(1);

    // Simulate competitor 1 arriving 150ms after trigger
    const comp1: IncomingMessage = {
      eventId: 'msg-002',
      threadId: 'thread-test-race',
      senderId: 'rival-001',
      body: 'Me down',
      receivedAtEpochMs: Date.now(),
      sourceTimestampEpochMs: Date.now(),
    };
    tracker.recordContender(comp1);

    // Simulate competitor 2 arriving 320ms after trigger
    const comp2: IncomingMessage = {
      eventId: 'msg-003',
      threadId: 'thread-test-race',
      senderId: 'rival-002',
      body: 'book please',
      receivedAtEpochMs: Date.now(),
      sourceTimestampEpochMs: Date.now(),
    };
    tracker.recordContender(comp2);

    const finalized = tracker.finalizeRound('thread-test-race');
    expect(finalized).toBeDefined();
    expect(finalized?.ourRankInQueue).toBe(1);
    expect(finalized?.totalContenders).toBe(3);
    expect(finalized?.contenders).toHaveLength(3);
    expect(finalized?.timeAheadOfNextMs).toBeGreaterThan(0);
    expect(onFinalized).toHaveBeenCalledWith(finalized);
  });
});
