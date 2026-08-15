import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockMessengerTransport } from '../../src/adapters/messenger/mock-messenger-transport.js';
import { bootstrap } from '../../src/app/bootstrap.js';
import { createLogger } from '../../src/infrastructure/logging/logger.js';
import { loadConfig } from '../../src/infrastructure/config/env.js';
import { message, NOW } from '../fixtures/messages.js';

const directories: string[] = [];
function statePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'open-book-durable-'));
  directories.push(directory);
  return join(directory, 'worker.sqlite');
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('durable daemon state', () => {
  it('preserves dedupe and cooldown across a restart', async () => {
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
      COOLDOWN_MS: '300000',
      MAX_EVENT_AGE_MS: '10000',
      HEALTH_HOST: '127.0.0.1',
      HEALTH_PORT: '0',
      STATE_DB_PATH: statePath(),
    });
    const clock = { nowEpochMs: () => NOW };
    const firstTransport = new MockMessengerTransport();
    const first = await bootstrap({
      config,
      clock,
      transport: firstTransport,
      logger: createLogger('silent'),
    });
    expect(await first.process(message())).toMatchObject({
      decision: 'MATCH',
      status: 'DRY_RUN_DISPATCHED',
    });
    await first.shutdown();

    const secondTransport = new MockMessengerTransport();
    const second = await bootstrap({
      config,
      clock,
      transport: secondTransport,
      logger: createLogger('silent'),
    });
    expect(await second.process(message())).toMatchObject({
      decision: 'DUPLICATE',
      status: 'IGNORED',
    });
    expect(
      await second.process(message({ eventId: 'event-after-restart' })),
    ).toMatchObject({ decision: 'NO_MATCH', reasonCode: 'cooldown_active' });
    expect(secondTransport.dispatches).toEqual([]);
    await second.shutdown();
  });
});
