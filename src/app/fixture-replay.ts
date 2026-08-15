import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { MockMessengerTransport } from '../adapters/messenger/mock-messenger-transport.js';
import type { DispatchResult } from '../domain/events/dispatch-result.js';
import type { IncomingMessage } from '../domain/events/incoming-message.js';
import { loadConfig } from '../infrastructure/config/env.js';
import { createLogger } from '../infrastructure/logging/logger.js';
import { bootstrap, type RunningApp } from './bootstrap.js';

const timestampSchema = z.union([z.number().finite(), z.literal('$now')]);
const fixtureSchema = z
  .object({
    eventId: z.string().trim().min(1),
    threadId: z.string().trim().min(1),
    senderId: z.string().trim().min(1),
    body: z.string().trim().min(1),
    receivedAtEpochMs: timestampSchema,
    sourceTimestampEpochMs: timestampSchema,
  })
  .strict();

export type CliMode =
  { mode: 'daemon' } | { mode: 'fixture'; path: string } | { mode: 'stream' };

export interface FixtureSummary {
  mode: 'dry-run';
  eventId: string;
  dispatches: ReadonlyArray<{ threadId: string; text: string }>;
}

export interface StreamRecord extends DispatchResult {
  line: number;
  ok: true;
}

export interface StreamErrorRecord {
  line: number;
  ok: false;
  eventId: null;
  decision: null;
  status: 'FAILED';
  reasonCode: 'invalid_input';
  error: string;
}

export function parseArgs(args: readonly string[]): CliMode {
  if (args.length === 0) return { mode: 'daemon' };
  if (args.length === 1 && args[0] === '--stream') return { mode: 'stream' };
  if (args.length === 2 && args[0] === '--fixture' && args[1]?.trim()) {
    return { mode: 'fixture', path: args[1] };
  }
  throw new Error(
    'Usage: open-book-event-worker [--fixture <path> | --stream]',
  );
}

export function parseFixture(
  value: unknown,
  nowEpochMs = Date.now(),
): IncomingMessage {
  const parsed = fixtureSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid fixture: ${z.prettifyError(parsed.error)}`);
  }
  return {
    ...parsed.data,
    receivedAtEpochMs:
      parsed.data.receivedAtEpochMs === '$now'
        ? nowEpochMs
        : parsed.data.receivedAtEpochMs,
    sourceTimestampEpochMs:
      parsed.data.sourceTimestampEpochMs === '$now'
        ? nowEpochMs
        : parsed.data.sourceTimestampEpochMs,
  };
}

export async function loadFixture(
  path: string,
  nowEpochMs = Date.now(),
): Promise<IncomingMessage> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot read fixture ${path}: ${error instanceof Error ? error.message : 'unknown error'}`,
      { cause: error },
    );
  }
  return parseFixture(value, nowEpochMs);
}

const fixtureDefaults: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  APP_MODE: 'dry-run',
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
};

export async function createMockApp(
  env: NodeJS.ProcessEnv = process.env,
  transport = new MockMessengerTransport(),
): Promise<{ app: RunningApp; transport: MockMessengerTransport }> {
  const config = loadConfig({
    ...fixtureDefaults,
    ...env,
    HEALTH_PORT: '0',
    LOG_LEVEL: 'silent',
  });
  return {
    app: await bootstrap({
      config,
      transport,
      logger: createLogger('silent'),
      stateMode: 'ephemeral',
    }),
    transport,
  };
}

export async function runFixture(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
  transport = new MockMessengerTransport(),
): Promise<FixtureSummary> {
  const event = await loadFixture(path);
  const running = await createMockApp(env, transport);
  try {
    await running.app.process(event);
    return {
      mode: 'dry-run',
      eventId: event.eventId,
      dispatches: [...transport.dispatches],
    };
  } finally {
    await running.app.shutdown();
  }
}

export async function runStream(
  input: Readable,
  output: Writable,
  env: NodeJS.ProcessEnv = process.env,
  options: {
    signal?: AbortSignal;
    transport?: MockMessengerTransport;
  } = {},
): Promise<void> {
  const running = await createMockApp(
    env,
    options.transport ?? new MockMessengerTransport(),
  );
  const lines = createInterface({ input, crlfDelay: Infinity });
  const abort = () => lines.close();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) lines.close();
  const streamEpochMs = Date.now();
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      const json =
        lineNumber === 1 && line.charCodeAt(0) === 0xfeff
          ? line.slice(1)
          : line;
      let event: IncomingMessage;
      try {
        event = parseFixture(JSON.parse(json) as unknown, streamEpochMs);
      } catch (error) {
        await writeRecord(output, {
          line: lineNumber,
          ok: false,
          eventId: null,
          decision: null,
          status: 'FAILED',
          reasonCode: 'invalid_input',
          error: error instanceof Error ? error.message : 'Unknown input error',
        });
        continue;
      }
      const result = await running.app.process(event);
      await writeRecord(output, { line: lineNumber, ok: true, ...result });
    }
  } finally {
    options.signal?.removeEventListener('abort', abort);
    lines.close();
    await running.app.shutdown();
  }
}

async function writeRecord(
  output: Writable,
  record: StreamRecord | StreamErrorRecord,
): Promise<void> {
  if (!output.write(`${JSON.stringify(record)}\n`)) {
    await once(output, 'drain');
  }
}
