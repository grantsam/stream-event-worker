import type { Logger } from 'pino';
import type { DispatchResult } from '../domain/events/dispatch-result.js';
import type { IncomingMessage } from '../domain/events/incoming-message.js';
import type { RuleEngine } from '../domain/rules/rule-engine.js';
import { hashIdentifier } from '../infrastructure/logging/logger.js';
import { LatencyRecorder } from '../infrastructure/metrics/latency-recorder.js';
import type { RuntimeMetrics } from '../infrastructure/metrics/runtime-metrics.js';
import type { ResponseCoordinator } from './response-coordinator.js';

export class ProcessIncomingMessage {
  constructor(
    private readonly ruleEngine: RuleEngine,
    private readonly coordinator: ResponseCoordinator,
    private readonly logger: Logger,
    private readonly metrics?: RuntimeMetrics,
  ) {}

  async execute(
    event: IncomingMessage,
    latency = new LatencyRecorder(),
  ): Promise<DispatchResult> {
    this.metrics?.startProcessing();
    try {
      latency.mark('event_received');
      const rule = this.ruleEngine.evaluate(event, latency);
      console.log(
        `[EVALUATION] threadID="${event.threadId}" senderID="${event.senderId}" body="${event.body}" -> decision=${rule.decision} reason=${rule.reasonCode}`,
      );
      const result = await this.coordinator.coordinate(event, rule, latency);
      if (result.status === 'DRY_RUN_DISPATCHED') {
        console.log(
          `[DISPATCHED] Successfully sent reply to threadID="${event.threadId}"`,
        );
      }
      const latencyMetrics = latency.metrics();
      this.metrics?.finishProcessing(
        result.decision,
        result.status,
        result.reasonCode,
        latencyMetrics,
      );
      this.logger.info(
        {
          eventId: event.eventId,
          decision: result.decision,
          reasonCode: result.reasonCode,
          threadIdHash: hashIdentifier(event.threadId),
          senderIdHash: hashIdentifier(event.senderId),
          latency: latencyMetrics,
        },
        'incoming message processed',
      );
      return result;
    } catch (error) {
      this.metrics?.failProcessing();
      throw error;
    }
  }
}
