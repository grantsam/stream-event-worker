import { normalizeMessage } from './message-normalizer.js';

export class PatternMatcher {
  private readonly triggers: ReadonlySet<string>;

  constructor(triggers: readonly string[]) {
    this.triggers = new Set(triggers.map(normalizeMessage));
  }

  matches(normalizedBody: string): boolean {
    return normalizedBody.length > 0 && this.triggers.has(normalizedBody);
  }
}
