import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockMessengerTransport } from '../adapters/messenger/mock-messenger-transport.js';
import { bootstrap } from './bootstrap.js';
import { createSyntheticEvent, MutableEpochClock } from './local-benchmark.js';
import { loadConfig } from '../infrastructure/config/env.js';
import { createLogger } from '../infrastructure/logging/logger.js';

export interface RegressionSummary {
  mode: 'durable_restart_regression';
  generatedEvents: number;
  processedEvents: number;
  dispatches: number;
  duplicateDispatches: number;
  gaps: number;
  errors: number;
  restarts: number;
  scope: 'local_worker_mock_transport_only';
  messengerE2e: false;
}

export async function runDurableRestartRegression(
  eventCount = 100,
): Promise<RegressionSummary> {
  if (!Number.isSafeInteger(eventCount) || eventCount < 3) {
    throw new Error('eventCount must be a safe integer of at least 3');
  }
  const directory = mkdtempSync(join(tmpdir(), 'open-book-regression-'));
  const clock = new MutableEpochClock(Date.now());
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_MODE: 'dry-run',
    LOG_LEVEL: 'silent',
    TRANSPORT_ADAPTER: 'mock',
    TIMEZONE: 'Asia/Jakarta',
    TARGET_THREAD_ID: 'thread-test-001',
    AUTHORIZED_SENDER_IDS: 'admin-test-001',
    TRIGGER_PHRASES: 'open book',
    RESPONSE_TEXT: 'Me down',
    ACTIVE_WINDOWS: 'MON-SUN@00:00-23:59',
    COOLDOWN_MS: '1',
    MAX_EVENT_AGE_MS: '10000',
    HEALTH_HOST: '127.0.0.1',
    HEALTH_PORT: '0',
    STATE_DB_PATH: join(directory, 'worker.sqlite'),
  });
  let app = await start(config, clock);
  let generatedEvents = 0;
  let processedEvents = 0;
  let dispatches = 0;
  let duplicateDispatches = 0;
  let errors = 0;
  let restarts = 0;

  try {
    for (let sequence = 1; sequence <= eventCount; sequence += 1) {
      const event = createSyntheticEvent(sequence, clock.nowEpochMs());
      generatedEvents += 1;
      const result = await app.app.process(event);
      processedEvents += 1;
      dispatches += app.transport.dispatches.length;
      app.transport.dispatches.length = 0;
      if (result.status !== 'DRY_RUN_DISPATCHED') errors += 1;
      clock.advance(2);

      if (sequence === Math.floor(eventCount / 2)) {
        await app.app.shutdown();
        app = await start(config, clock);
        restarts += 1;
        const replay = await app.app.process(event);
        processedEvents += 1;
        duplicateDispatches += app.transport.dispatches.length;
        app.transport.dispatches.length = 0;
        if (replay.decision !== 'DUPLICATE' || replay.status !== 'IGNORED')
          errors += 1;
      }
    }
  } finally {
    await app.app.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }

  return {
    mode: 'durable_restart_regression',
    generatedEvents,
    processedEvents,
    dispatches,
    duplicateDispatches,
    gaps: Math.max(0, generatedEvents + restarts - processedEvents),
    errors,
    restarts,
    scope: 'local_worker_mock_transport_only',
    messengerE2e: false,
  };
}

async function start(
  config: ReturnType<typeof loadConfig>,
  clock: MutableEpochClock,
) {
  const transport = new MockMessengerTransport();
  return {
    transport,
    app: await bootstrap({
      config,
      clock,
      transport,
      logger: createLogger('silent'),
    }),
  };
}
