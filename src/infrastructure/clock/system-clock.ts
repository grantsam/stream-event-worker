import type { Clock } from './clock.js';

export class SystemClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}
