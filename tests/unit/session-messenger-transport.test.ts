import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from '../../src/domain/events/incoming-message.js';
import {
  loadAppState,
  type AppStateCookie,
} from '../../src/adapters/messenger/appstate-loader.js';
import {
  SessionMessengerTransport,
  type MessengerSessionDriver,
  type RawMessengerMessage,
} from '../../src/adapters/messenger/session-messenger-transport.js';

describe('AppState Loader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'appstate-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('successfully loads and validates cookies with c_user and xs', () => {
    const filePath = join(tempDir, 'valid-appstate.json');
    const cookies = [
      {
        key: 'c_user',
        value: '1000999888777',
        domain: '.facebook.com',
        path: '/',
      },
      {
        key: 'xs',
        value: '2:secret-session-token',
        domain: '.facebook.com',
        path: '/',
      },
      {
        name: 'datr',
        value: 'datr-token-123',
        domain: '.facebook.com',
        path: '/',
      },
    ];
    writeFileSync(filePath, JSON.stringify(cookies), 'utf8');

    const result = loadAppState(filePath);
    expect(result.userId).toBe('1000999888777');
    expect(result.cookies).toHaveLength(3);
    expect(result.cookies.find((c) => c.key === 'datr')?.value).toBe(
      'datr-token-123',
    );
  });

  it('throws when appstate file does not exist', () => {
    const filePath = join(tempDir, 'non-existent.json');
    expect(() => loadAppState(filePath)).toThrow(
      'AppState cookie file not found',
    );
  });

  it('throws when appstate file contains invalid JSON', () => {
    const filePath = join(tempDir, 'invalid.json');
    writeFileSync(filePath, '{ not a valid json }', 'utf8');
    expect(() => loadAppState(filePath)).toThrow('contains invalid JSON');
  });

  it('throws when appstate is not an array', () => {
    const filePath = join(tempDir, 'object.json');
    writeFileSync(filePath, JSON.stringify({ key: 'value' }), 'utf8');
    expect(() => loadAppState(filePath)).toThrow('must be a non-empty array');
  });

  it('throws when c_user cookie is missing', () => {
    const filePath = join(tempDir, 'no-cuser.json');
    writeFileSync(
      filePath,
      JSON.stringify([
        { key: 'xs', value: 'token', domain: '.facebook.com', path: '/' },
      ]),
      'utf8',
    );
    expect(() => loadAppState(filePath)).toThrow("missing the 'c_user' cookie");
  });

  it('throws when xs cookie is missing', () => {
    const filePath = join(tempDir, 'no-xs.json');
    writeFileSync(
      filePath,
      JSON.stringify([
        { key: 'c_user', value: '123', domain: '.facebook.com', path: '/' },
      ]),
      'utf8',
    );
    expect(() => loadAppState(filePath)).toThrow(
      "missing the 'xs' session cookie",
    );
  });
});

describe('SessionMessengerTransport', () => {
  let tempDir: string;
  let validAppStatePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-transport-test-'));
    validAppStatePath = join(tempDir, 'appstate.json');
    writeFileSync(
      validAppStatePath,
      JSON.stringify([
        {
          key: 'c_user',
          value: 'user-100',
          domain: '.facebook.com',
          path: '/',
        },
        {
          key: 'xs',
          value: 'xs-token-100',
          domain: '.facebook.com',
          path: '/',
        },
      ]),
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  class MockDriver implements MessengerSessionDriver {
    connected = false;
    loggedCookies: AppStateCookie[] = [];
    sentMessages: Array<{ threadId: string; text: string }> = [];
    typingIndicators: string[] = [];
    readReceipts: string[] = [];
    private messageCallback: ((msg: RawMessengerMessage) => void) | null = null;

    async login(cookies: AppStateCookie[]): Promise<void> {
      this.connected = true;
      this.loggedCookies = cookies;
    }

    async logout(): Promise<void> {
      this.connected = false;
      this.messageCallback = null;
    }

    onMessage(callback: (message: RawMessengerMessage) => void): () => void {
      this.messageCallback = callback;
      return () => {
        if (this.messageCallback === callback) this.messageCallback = null;
      };
    }

    async sendMessage(threadId: string, text: string): Promise<void> {
      this.sentMessages.push({ threadId, text });
    }

    async sendTypingIndicator(threadId: string): Promise<void> {
      this.typingIndicators.push(threadId);
    }

    async markAsRead(threadId: string): Promise<void> {
      this.readReceipts.push(threadId);
    }

    isConnected(): boolean {
      return this.connected;
    }

    emitRaw(msg: RawMessengerMessage) {
      if (this.messageCallback) this.messageCallback(msg);
    }
  }

  it('authenticates, normalizes inbound events, and reports health', async () => {
    const driver = new MockDriver();
    const transport = new SessionMessengerTransport({
      appStatePath: validAppStatePath,
      driver,
      simulateTyping: false,
    });

    expect(transport.health()).toEqual({
      connected: false,
      adapter: 'live-session',
    });

    await transport.connect();

    expect(transport.health()).toEqual({
      connected: true,
      adapter: 'live-session',
    });
    expect(transport.getUserId()).toBe('user-100');
    expect(driver.loggedCookies).toHaveLength(2);

    const received: IncomingMessage[] = [];
    transport.subscribe(async (event) => {
      received.push(event);
    });

    driver.emitRaw({
      messageID: 'msg-999',
      threadID: 'thread-888',
      senderID: 'sender-777',
      body: 'open book',
      timestamp: 1700000000000,
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      eventId: 'msg-999',
      threadId: 'thread-888',
      senderId: 'sender-777',
      body: 'open book',
      sourceTimestampEpochMs: 1700000000000,
    });

    await transport.disconnect();
    expect(transport.health().connected).toBe(false);
  });

  it('performs anti-bot typing and read receipt simulation on sendText', async () => {
    const driver = new MockDriver();
    const transport = new SessionMessengerTransport({
      appStatePath: validAppStatePath,
      driver,
      simulateTyping: true,
      typingDelayMs: 30,
    });

    await transport.connect();

    const startTime = Date.now();
    await transport.sendText('thread-123', 'Me down');
    const elapsed = Date.now() - startTime;

    expect(driver.readReceipts).toContain('thread-123');
    expect(driver.typingIndicators).toContain('thread-123');
    expect(driver.sentMessages).toEqual([
      { threadId: 'thread-123', text: 'Me down' },
    ]);
    expect(elapsed).toBeGreaterThanOrEqual(15);

    await transport.disconnect();
  });

  it('throws error when sendText is called while disconnected', async () => {
    const driver = new MockDriver();
    const transport = new SessionMessengerTransport({
      appStatePath: validAppStatePath,
      driver,
    });

    await expect(transport.sendText('thread-1', 'hi')).rejects.toThrow(
      'Session transport is disconnected',
    );
  });
});
