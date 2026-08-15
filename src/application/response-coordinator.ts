import type { DispatchResult } from '../domain/events/dispatch-result.js';
import type { IncomingMessage } from '../domain/events/incoming-message.js';
import type { RuleOutcome } from '../domain/rules/rule-engine.js';
import type { MessengerTransport } from '../adapters/messenger/messenger-transport.js';
import type { LatencyRecorder } from '../infrastructure/metrics/latency-recorder.js';

export class ResponseCoordinator {
  constructor(
    private readonly transport: MessengerTransport,
    private readonly responseText: string,
  ) {}

  async coordinate(
    event: IncomingMessage,
    rule: RuleOutcome,
    latency: LatencyRecorder,
  ): Promise<DispatchResult> {
    if (rule.decision !== 'MATCH') {
      return {
        eventId: event.eventId,
        decision: rule.decision,
        reasonCode: rule.reasonCode,
        status: 'IGNORED',
      };
    }
    latency.mark('dispatch_started');
    try {
      await this.transport.sendText(event.threadId, this.responseText);
      latency.mark('dispatch_completed');
      return {
        eventId: event.eventId,
        decision: rule.decision,
        reasonCode: rule.reasonCode,
        status: 'DRY_RUN_DISPATCHED',
      };
    } catch (error) {
      latency.mark('dispatch_completed');
      return {
        eventId: event.eventId,
        decision: rule.decision,
        reasonCode: 'mock_dispatch_failed',
        status: 'FAILED',
        error:
          error instanceof Error ? error.message : 'Unknown dispatch failure',
      };
    }
  }
}
