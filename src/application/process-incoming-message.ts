import type { Logger } from 'pino';
import type { DispatchResult } from '../domain/events/dispatch-result.js';
import type { IncomingMessage } from '../domain/events/incoming-message.js';
import { RaceTracker } from '../domain/race/race-tracker.js';
import type { RuleEngine } from '../domain/rules/rule-engine.js';
import type { HitLogger } from '../infrastructure/logging/hit-logger.js';
import { hashIdentifier } from '../infrastructure/logging/logger.js';
import { LatencyRecorder } from '../infrastructure/metrics/latency-recorder.js';
import type { RuntimeMetrics } from '../infrastructure/metrics/runtime-metrics.js';
import type { ResponseCoordinator } from './response-coordinator.js';

export class ProcessIncomingMessage {
  private readonly raceTracker: RaceTracker;

  constructor(
    private readonly ruleEngine: RuleEngine,
    private readonly coordinator: ResponseCoordinator,
    private readonly logger: Logger,
    private readonly metrics?: RuntimeMetrics,
    private readonly hitLogger?: HitLogger,
    private readonly clientName = 'default',
    private readonly responseText = 'Me down',
    raceTracker?: RaceTracker,
  ) {
    this.raceTracker = raceTracker ?? new RaceTracker();
  }

  async execute(
    event: IncomingMessage,
    latency = new LatencyRecorder(),
  ): Promise<DispatchResult> {
    this.metrics?.startProcessing();
    try {
      latency.mark('event_received');

      // If a race round is currently active on this thread, record this contender
      if (this.raceTracker.isRoundActive(event.threadId)) {
        this.raceTracker.recordContender(event);
      }

      const rule = this.ruleEngine.evaluate(event, latency);
      console.log(
        `[EVALUATION] threadID="${event.threadId}" senderID="${event.senderId}" body="${event.body}" -> decision=${rule.decision} reason=${rule.reasonCode}`,
      );
      const result = await this.coordinator.coordinate(event, rule, latency);
      const latencyMetrics = latency.metrics();

      if (result.status === 'DRY_RUN_DISPATCHED') {
        console.log(
          `[DISPATCHED] Successfully sent reply to threadID="${event.threadId}"`,
        );
        const reactionTimeMs =
          latencyMetrics.receive_to_dispatch_ms ??
          latencyMetrics.receive_to_match_ms ??
          0;
        const hit = {
          id: event.eventId,
          clientName: this.clientName,
          timestamp: new Date().toISOString(),
          epochMs: Date.now(),
          threadId: event.threadId,
          senderId: event.senderId,
          triggerPhrase: event.body,
          responseText: this.responseText,
          reactionTimeMs,
          status: 'SUCCESS' as const,
        };

        const initialHit = this.raceTracker.startRound(hit, (updated) => {
          this.hitLogger?.updateHit(updated);
        });

        this.hitLogger?.recordHit(initialHit);
      }
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
