import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MockMessengerTransport } from '../../src/adapters/messenger/mock-messenger-transport.js';
import { runStream } from '../../src/app/fixture-replay.js';

const event = (eventId: string, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    eventId,
    threadId: 'thread-test-001',
    senderId: 'admin-test-001',
    body: 'open book',
    receivedAtEpochMs: '$now',
    sourceTimestampEpochMs: '$now',
    ...overrides,
  });

async function replay(lines: readonly string[]) {
  const transport = new MockMessengerTransport();
  let output = '';
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  await runStream(
    Readable.from(lines.map((line) => `${line}\n`)),
    writable,
    {},
    { transport },
  );
  return {
    records: output
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>),
    transport,
  };
}

describe('JSONL stream replay', () => {
  it('processes sequentially with shared dedupe and cooldown state', async () => {
    const { records, transport } = await replay([
      event('event-001'),
      event('event-001'),
      event('event-002'),
    ]);
    expect(records).toMatchObject([
      {
        line: 1,
        ok: true,
        decision: 'MATCH',
        status: 'DRY_RUN_DISPATCHED',
        reasonCode: 'trigger_matched',
      },
      {
        line: 2,
        ok: true,
        decision: 'DUPLICATE',
        status: 'IGNORED',
        reasonCode: 'duplicate_fingerprint',
      },
      {
        line: 3,
        ok: true,
        decision: 'NO_MATCH',
        status: 'IGNORED',
        reasonCode: 'cooldown_active',
      },
    ]);
    expect(transport.dispatches).toEqual([
      { threadId: 'thread-test-001', text: 'Me down' },
    ]);
    expect(transport.health().connected).toBe(false);
  });

  it('accepts a PowerShell UTF-8 BOM on the first line', async () => {
    const { records } = await replay([
      `${String.fromCharCode(0xfeff)}${event('event-bom')}`,
    ]);
    expect(records).toMatchObject([
      {
        line: 1,
        ok: true,
        decision: 'MATCH',
        status: 'DRY_RUN_DISPATCHED',
      },
    ]);
  });

  it('reports invalid lines and continues processing later events', async () => {
    const { records } = await replay([
      'not-json',
      '',
      event('event-invalid', { extra: true }),
      event('event-negative', { body: 'belum open book' }),
      event('event-sender', { senderId: 'sender-test-other' }),
      event('event-thread', { threadId: 'thread-test-other' }),
    ]);
    expect(records).toHaveLength(6);
    expect(records.slice(0, 3)).toMatchObject([
      {
        line: 1,
        ok: false,
        status: 'FAILED',
        reasonCode: 'invalid_input',
      },
      {
        line: 2,
        ok: false,
        status: 'FAILED',
        reasonCode: 'invalid_input',
      },
      {
        line: 3,
        ok: false,
        status: 'FAILED',
        reasonCode: 'invalid_input',
      },
    ]);
    expect(records.slice(3)).toMatchObject([
      {
        line: 4,
        ok: true,
        decision: 'NO_MATCH',
        reasonCode: 'trigger_not_matched',
      },
      {
        line: 5,
        ok: true,
        decision: 'NO_MATCH',
        reasonCode: 'unauthorized_sender',
      },
      {
        line: 6,
        ok: true,
        decision: 'NO_MATCH',
        reasonCode: 'wrong_thread',
      },
    ]);
  });
});
