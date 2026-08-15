import type { Logger } from 'pino';
import { MockMessengerTransport } from '../adapters/messenger/mock-messenger-transport.js';
import { SessionMessengerTransport } from '../adapters/messenger/session-messenger-transport.js';
import type { DispatchResult } from '../domain/events/dispatch-result.js';
import type { IncomingMessage } from '../domain/events/incoming-message.js';
import type { IdempotencyStore } from '../domain/idempotency/idempotency-store.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency/in-memory-idempotency-store.js';
import { PatternMatcher } from '../domain/rules/pattern-matcher.js';
import { RuleEngine } from '../domain/rules/rule-engine.js';
import { ScheduleMatcher } from '../domain/rules/schedule-matcher.js';
import type { OpenBookSessionManager } from '../domain/session/open-book-session-manager.js';
import { InMemoryOpenBookSessionManager } from '../domain/session/open-book-session-manager.js';
import type { MessengerTransport } from '../adapters/messenger/messenger-transport.js';
import { ProcessIncomingMessage } from '../application/process-incoming-message.js';
import { ResponseCoordinator } from '../application/response-coordinator.js';
import type { Clock } from '../infrastructure/clock/clock.js';
import { SystemClock } from '../infrastructure/clock/system-clock.js';
import { loadConfig, type AppConfig } from '../infrastructure/config/env.js';
import {
  HealthServer,
  type ReadinessState,
} from '../infrastructure/health/health-server.js';
import { createLogger } from '../infrastructure/logging/logger.js';
import { HitLogger } from '../infrastructure/logging/hit-logger.js';
import type { LatencyRecorder } from '../infrastructure/metrics/latency-recorder.js';
import { RuntimeMetrics } from '../infrastructure/metrics/runtime-metrics.js';
import { SqliteStateStore } from '../infrastructure/persistence/sqlite-state-store.js';
import { createShutdown, type CloseableState } from './shutdown.js';

export interface AppDependencies {
  config?: AppConfig;
  clock?: Clock;
  transport?: MessengerTransport;
  logger?: Logger;
  metrics?: RuntimeMetrics;
  stateMode?: 'durable' | 'ephemeral';
  idempotencyStore?: IdempotencyStore;
  sessionManager?: OpenBookSessionManager;
}

export interface RunningApp {
  config: AppConfig;
  transport: MessengerTransport;
  healthServer: HealthServer;
  process: (
    event: IncomingMessage,
    latency?: LatencyRecorder,
  ) => Promise<DispatchResult>;
  shutdown: () => Promise<void>;
}

export async function bootstrap(
  dependencies: AppDependencies = {},
): Promise<RunningApp> {
  const config = dependencies.config ?? loadConfig();
  const logger = dependencies.logger ?? createLogger(config.LOG_LEVEL);
  const metrics = dependencies.metrics ?? new RuntimeMetrics();
  const clock = dependencies.clock ?? new SystemClock();
  const transport =
    dependencies.transport ??
    (config.TRANSPORT_ADAPTER === 'live-session'
      ? new SessionMessengerTransport({
          appStatePath: config.APP_STATE_PATH,
          typingDelayMs: config.TYPING_DELAY_MS,
          simulateTyping: config.SIMULATE_TYPING,
        })
      : new MockMessengerTransport());
  const stores = createStores(config, dependencies);
  const schedule = new ScheduleMatcher(config.TIMEZONE, config.ACTIVE_WINDOWS);
  const rules = new RuleEngine(
    {
      targetThreadId: config.TARGET_THREAD_ID,
      authorizedSenderIds: config.AUTHORIZED_SENDER_IDS,
      maxEventAgeMs: config.MAX_EVENT_AGE_MS,
      cooldownMs: config.COOLDOWN_MS,
      dedupeTtlMs: Math.max(config.COOLDOWN_MS, config.MAX_EVENT_AGE_MS),
    },
    clock,
    new PatternMatcher(config.TRIGGER_PHRASES),
    schedule,
    stores.idempotencyStore,
    stores.sessionManager,
  );
  const coordinator = new ResponseCoordinator(transport, config.RESPONSE_TEXT);
  const hitLogger = new HitLogger(config.HITS_LOG_PATH);
  const processor = new ProcessIncomingMessage(
    rules,
    coordinator,
    logger,
    metrics,
    hitLogger,
    config.CLIENT_NAME,
    config.RESPONSE_TEXT,
  );
  const state: ReadinessState = {
    configValid: true,
    modeSupported:
      (config.APP_MODE === 'dry-run' && config.TRANSPORT_ADAPTER === 'mock') ||
      (config.APP_MODE === 'live' &&
        config.TRANSPORT_ADAPTER === 'live-session'),
    ruleEngineReady: rules.ready(),
    persistenceReady: true,
    shuttingDown: false,
  };
  const healthServer = new HealthServer(
    config.HEALTH_HOST,
    config.HEALTH_PORT,
    state,
    transport,
    config.METRICS_ENABLED,
    () => metrics.snapshot(),
  );
  const process = async (
    event: IncomingMessage,
    latency?: LatencyRecorder,
  ): Promise<DispatchResult> => {
    if (state.shuttingDown) throw new Error('Worker is shutting down');
    try {
      return await processor.execute(event, latency);
    } catch (error) {
      if (isPersistenceError(error)) state.persistenceReady = false;
      throw error;
    }
  };
  let unsubscribe: () => void = () => {};

  try {
    await transport.connect();
    unsubscribe = transport.subscribe(async (event) => {
      await process(event);
    });
    await healthServer.start();
  } catch (error) {
    await cleanupStartup(
      unsubscribe,
      transport,
      healthServer,
      stores.closeableState,
    );
    throw error;
  }

  const shutdown = createShutdown(
    state,
    unsubscribe,
    transport,
    healthServer,
    logger,
    stores.closeableState,
  );
  logger.info(
    {
      host: config.HEALTH_HOST,
      port: healthServer.address().port,
      mode: config.APP_MODE,
    },
    'worker ready',
  );
  return { config, transport, healthServer, process, shutdown };
}

function createStores(
  config: AppConfig,
  dependencies: AppDependencies,
): {
  idempotencyStore: IdempotencyStore;
  sessionManager: OpenBookSessionManager;
  closeableState?: CloseableState;
} {
  const injected = Boolean(dependencies.idempotencyStore);
  if (injected !== Boolean(dependencies.sessionManager)) {
    throw new Error(
      'idempotencyStore and sessionManager must be injected together',
    );
  }
  if (injected) {
    return {
      idempotencyStore: dependencies.idempotencyStore!,
      sessionManager: dependencies.sessionManager!,
    };
  }
  if ((dependencies.stateMode ?? 'durable') === 'ephemeral') {
    return {
      idempotencyStore: new InMemoryIdempotencyStore(),
      sessionManager: new InMemoryOpenBookSessionManager(),
    };
  }
  const durableState = new SqliteStateStore(config.STATE_DB_PATH);
  return {
    idempotencyStore: durableState,
    sessionManager: durableState,
    closeableState: durableState,
  };
}

function isPersistenceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /sqlite|database|state store/i.test(message);
}

async function cleanupStartup(
  unsubscribe: () => void,
  transport: MessengerTransport,
  healthServer: HealthServer,
  closeableState?: CloseableState,
): Promise<void> {
  let failure: unknown;
  for (const cleanup of [
    () => unsubscribe(),
    () => transport.disconnect(),
    () => healthServer.close(),
    () => closeableState?.close(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
