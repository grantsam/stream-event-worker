import type { IdempotencyStore } from './idempotency-store.js';

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly expirations = new Map<string, number>();
  private claimsSinceCleanup = 0;

  claim(fingerprint: string, nowEpochMs: number, ttlMs: number): boolean {
    if (++this.claimsSinceCleanup >= 1_024) {
      this.claimsSinceCleanup = 0;
      for (const [key, expiresAt] of this.expirations) {
        if (expiresAt <= nowEpochMs) this.expirations.delete(key);
      }
    }

    const expiresAt = this.expirations.get(fingerprint);
    if (expiresAt !== undefined && expiresAt > nowEpochMs) return false;

    this.expirations.set(fingerprint, nowEpochMs + ttlMs);
    return true;
  }
}
