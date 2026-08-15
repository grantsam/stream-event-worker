import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockMessengerTransport } from '../../src/adapters/messenger/mock-messenger-transport.js';
import {
  loadFixture,
  parseArgs,
  parseFixture,
  runFixture,
} from '../../src/app/fixture-replay.js';

const fixturePath = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'fixture-valid.json',
);
const env = {
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
  HEALTH_PORT: '3000',
};

describe('fixture replay', () => {
  it('accepts only daemon or one fixture argument', () => {
    expect(parseArgs([])).toEqual({ mode: 'daemon' });
    expect(parseArgs(['--fixture', 'event.json'])).toEqual({
      mode: 'fixture',
      path: 'event.json',
    });
    expect(parseArgs(['--stream'])).toEqual({ mode: 'stream' });
    expect(() => parseArgs(['--fixture'])).toThrow('Usage');
    expect(() => parseArgs(['--unknown'])).toThrow('Usage');
    expect(() => parseArgs(['--fixture', 'a.json', 'extra'])).toThrow('Usage');
  });

  it('strictly validates fixture data and resolves both now sentinels once', () => {
    expect(
      parseFixture(
        {
          eventId: 'event-test-001',
          threadId: 'thread-test-001',
          senderId: 'admin-test-001',
          body: 'open book',
          receivedAtEpochMs: '$now',
          sourceTimestampEpochMs: '$now',
        },
        1234,
      ),
    ).toMatchObject({
      receivedAtEpochMs: 1234,
      sourceTimestampEpochMs: 1234,
    });
    expect(() =>
      parseFixture({
        eventId: 'event-test-001',
        threadId: 'thread-test-001',
        senderId: 'admin-test-001',
        body: 'open book',
        receivedAtEpochMs: 1,
        sourceTimestampEpochMs: 1,
        extra: true,
      }),
    ).toThrow('Invalid fixture');
  });

  it('rejects malformed fixture JSON', async () => {
    await expect(loadFixture(import.meta.filename)).rejects.toThrow(
      'Cannot read fixture',
    );
  });

  it('replays one valid event, returns one dry-run dispatch, and shuts down', async () => {
    const transport = new MockMessengerTransport();
    const summary = await runFixture(fixturePath, {}, transport);
    expect(summary).toEqual({
      mode: 'dry-run',
      eventId: 'event-test-cli-001',
      dispatches: [{ threadId: 'thread-test-001', text: 'Me down' }],
    });
    expect(transport.health().connected).toBe(false);
  });

  it('returns an empty dispatch list for a valid non-match event', async () => {
    const transport = new MockMessengerTransport();
    const summary = await runFixture(
      fixturePath,
      { ...env, TRIGGER_PHRASES: 'different trigger' },
      transport,
    );
    expect(summary.dispatches).toEqual([]);
    expect(transport.health().connected).toBe(false);
  });
});
