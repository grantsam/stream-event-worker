export interface OpenBookSessionManager {
  claim(scope: string, nowEpochMs: number, cooldownMs: number): boolean;
}

export class InMemoryOpenBookSessionManager implements OpenBookSessionManager {
  private readonly cooldowns = new Map<string, number>();

  claim(scope: string, nowEpochMs: number, cooldownMs: number): boolean {
    const availableAt = this.cooldowns.get(scope);
    if (availableAt !== undefined && availableAt > nowEpochMs) return false;
    this.cooldowns.set(scope, nowEpochMs + cooldownMs);
    return true;
  }
}
