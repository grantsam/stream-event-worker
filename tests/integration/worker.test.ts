import { request } from 'node:http';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { MockMessengerTransport } from '../../src/adapters/messenger/mock-messenger-transport.js';
import type { MessengerTransport } from '../../src/adapters/messenger/messenger-transport.js';
import { UnsupportedLiveTransport } from '../../src/adapters/messenger/unsupported-live-transport.js';
import { bootstrap, type RunningApp } from '../../src/app/bootstrap.js';
import { createLogger } from '../../src/infrastructure/logging/logger.js';
import { loadConfig } from '../../src/infrastructure/config/env.js';
import { fixtures, message, NOW } from '../fixtures/messages.js';

const rawEnv = {
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
};

const config = loadConfig(rawEnv);

const apps: RunningApp[] = [];
async function start(
  transport: MessengerTransport = new MockMessengerTransport(),
) {
  const app = await bootstrap({
    config,
    clock: { nowEpochMs: () => NOW },
    transport,
    logger: createLogger('silent'),
    stateMode: 'ephemeral',
  });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.shutdown()));
});

describe('worker integration', () => {
  it('dispatches exactly one dry-run response for a valid event', async () => {
    const transport = new MockMessengerTransport();
    await start(transport);
    await transport.emit(fixtures.valid);
    expect(transport.dispatches).toEqual([
      { threadId: 'thread-test-001', text: 'Me down' },
    ]);
  });

  it('handles duplicate concurrent events with one dispatch', async () => {
    const transport = new MockMessengerTransport();
    await start(transport);
    await transport.emitDuplicate(fixtures.valid);
    expect(transport.dispatches).toHaveLength(1);
  });

  it('does not dispatch negative events', async () => {
    const transport = new MockMessengerTransport();
    await start(transport);
    for (const event of [
      fixtures.negativePhrase,
      fixtures.wrongSender,
      fixtures.wrongThread,
      fixtures.stale,
    ])
      await transport.emit(event);
    expect(transport.dispatches).toHaveLength(0);
  });

  it('records mock dispatch failure without a network retry', async () => {
    const transport = new MockMessengerTransport();
    await start(transport);
    transport.simulateSendFailure();
    await transport.emit(fixtures.valid);
    expect(transport.dispatches).toHaveLength(0);
  });

  it('supports replacing and restarting the transport boundary', async () => {
    const first = new MockMessengerTransport();
    const firstApp = await start(first);
    await firstApp.shutdown();
    apps.splice(apps.indexOf(firstApp), 1);
    const second = new MockMessengerTransport();
    await start(second);
    await second.emit(message({ eventId: 'event-restart' }));
    expect(second.dispatches).toHaveLength(1);
  });

  it('never enables the unsupported live transport', async () => {
    await expect(new UnsupportedLiveTransport().connect()).rejects.toThrow(
      'feasibility and security review',
    );
  });

  it('redacts credential-like logger fields', async () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createLogger('info', destination);
    logger.info(
      {
        authorization: 'secret-a',
        nested: { token: 'secret-b', cookie: 'secret-c' },
      },
      'redaction',
    );
    expect(output).not.toContain('secret-a');
    expect(output).not.toContain('secret-b');
    expect(output).not.toContain('secret-c');
    expect(output).toContain('[REDACTED]');
  });

  it('keeps metrics disabled unless explicitly enabled', async () => {
    const transport = new MockMessengerTransport();
    const app = await start(transport);
    const { host, port } = app.healthServer.address();
    expect((await get(host, port, '/metrics')).status).toBe(404);
  });

  it('serves health/readiness and graceful shutdown closes dependencies', async () => {
    const transport = new MockMessengerTransport();
    const app = await start(transport);
    const { host, port } = app.healthServer.address();
    expect((await get(host, port, '/healthz')).status).toBe(200);
    expect((await get(host, port, '/readyz')).status).toBe(200);
    transport.simulateDisconnect();
    expect((await get(host, port, '/readyz')).status).toBe(503);
    await app.shutdown();
    apps.splice(apps.indexOf(app), 1);
    expect(transport.health().connected).toBe(false);
    await expect(get(host, port, '/healthz')).rejects.toBeDefined();
  });

  it('supports live mode and live-session transport readiness', async () => {
    const liveConfig = loadConfig({
      ...rawEnv,
      APP_MODE: 'live',
      TRANSPORT_ADAPTER: 'live-session',
    });
    const transport = new MockMessengerTransport();
    const app = await bootstrap({
      config: liveConfig,
      clock: { nowEpochMs: () => NOW },
      transport,
      logger: createLogger('silent'),
      stateMode: 'ephemeral',
    });
    apps.push(app);
    const { host, port } = app.healthServer.address();
    expect((await get(host, port, '/readyz')).status).toBe(200);
  });
});

function get(
  host: string,
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path, method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, body }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}
