import type { Logger } from 'pino';
import type { MessengerTransport } from '../adapters/messenger/messenger-transport.js';
import type {
  HealthServer,
  ReadinessState,
} from '../infrastructure/health/health-server.js';

export interface CloseableState {
  close(): void;
}

export function createShutdown(
  state: ReadinessState,
  unsubscribe: () => void,
  transport: MessengerTransport,
  healthServer: HealthServer,
  logger: Logger,
  closeableState?: CloseableState,
): () => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;
  return () => {
    shutdownPromise ??= (async () => {
      state.shuttingDown = true;
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
      logger.info('shutdown complete');
    })();
    return shutdownPromise;
  };
}
