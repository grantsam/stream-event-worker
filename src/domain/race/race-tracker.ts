import type { ContenderEntry, HitRecord } from '../events/hit-record.js';
import type { IncomingMessage } from '../events/incoming-message.js';

interface ActiveRaceRound {
  hit: HitRecord;
  triggerEpochMs: number;
  contenders: ContenderEntry[];
  timer: NodeJS.Timeout;
  onFinalized?: ((updated: HitRecord) => void) | undefined;
}

export class RaceTracker {
  private readonly activeRounds = new Map<string, ActiveRaceRound>();

  constructor(private readonly raceWindowMs = 5000) {}

  startRound(
    hit: HitRecord,
    onFinalized?: (updated: HitRecord) => void,
  ): HitRecord {
    // Clear any existing round on this thread
    const existing = this.activeRounds.get(hit.threadId);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const ourEntry: ContenderEntry = {
      senderId: hit.clientName,
      body: hit.responseText,
      deltaMs: hit.reactionTimeMs,
      timestamp: hit.timestamp,
      isUs: true,
    };

    const initialHit: HitRecord = {
      ...hit,
      ourRankInQueue: 1,
      totalContenders: 1,
      timeAheadOfNextMs: null,
      contenders: [ourEntry],
      adminDecision: 'PENDING',
      adminSlotNumber: null,
    };

    const timer = setTimeout(() => {
      this.finalizeRound(hit.threadId);
    }, this.raceWindowMs);

    this.activeRounds.set(hit.threadId, {
      hit: initialHit,
      triggerEpochMs: hit.epochMs,
      contenders: [ourEntry],
      timer,
      onFinalized,
    });

    return initialHit;
  }

  recordContender(event: IncomingMessage): boolean {
    const round = this.activeRounds.get(event.threadId);
    if (!round) {
      return false;
    }

    // Calculate time elapsed since the trigger was posted
    const now = Date.now();
    const deltaMs = Math.max(1, now - round.triggerEpochMs);

    round.contenders.push({
      senderId: event.senderId,
      body: event.body,
      deltaMs,
      timestamp: new Date().toISOString(),
      isUs: false,
    });

    return true;
  }

  isRoundActive(threadId: string): boolean {
    return this.activeRounds.has(threadId);
  }

  finalizeRound(threadId: string): HitRecord | undefined {
    const round = this.activeRounds.get(threadId);
    if (!round) {
      return undefined;
    }

    clearTimeout(round.timer);
    this.activeRounds.delete(threadId);

    // Sort all contenders by reaction delta ascending
    round.contenders.sort((a, b) => a.deltaMs - b.deltaMs);

    const ourIndex = round.contenders.findIndex((c) => c.isUs);
    const ourRank = ourIndex >= 0 ? ourIndex + 1 : 1;
    const total = round.contenders.length;

    let timeAhead: number | null = null;
    if (ourRank === 1 && total > 1) {
      const secondPlace = round.contenders[1];
      if (secondPlace) {
        timeAhead = Math.max(
          0,
          secondPlace.deltaMs - round.contenders[0]!.deltaMs,
        );
      }
    }

    const updatedHit: HitRecord = {
      ...round.hit,
      ourRankInQueue: ourRank,
      totalContenders: total,
      timeAheadOfNextMs: timeAhead,
      contenders: round.contenders,
    };

    if (round.onFinalized) {
      round.onFinalized(updatedHit);
    }

    return updatedHit;
  }

  clear(): void {
    for (const round of this.activeRounds.values()) {
      clearTimeout(round.timer);
    }
    this.activeRounds.clear();
  }
}
