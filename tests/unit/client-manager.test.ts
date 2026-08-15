import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClientManager } from '../../src/app/client-manager.js';
import { HitLogger } from '../../src/infrastructure/logging/hit-logger.js';
import type { HitRecord } from '../../src/domain/events/hit-record.js';

describe('ClientManager', () => {
  let tempDir: string;
  let manager: ClientManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'client-manager-test-'));
    manager = new ClientManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates client profile with isolated directories and config template', () => {
    const res = manager.createProfile('alpha_corp', {
      TARGET_THREAD_ID: 'thread-999',
      RESPONSE_TEXT: 'Booked slot',
    });

    expect(res.profileDir).toContain('alpha_corp');
    expect(res.configPath).toContain('client.env');
    expect(res.appStatePath).toContain('appstate.json');

    const profiles = manager.listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe('alpha_corp');
    expect(profiles[0]!.hasConfig).toBe(true);
    expect(profiles[0]!.hasCookies).toBe(false); // [] is empty cookies
    expect(profiles[0]!.targetThreadId).toBe('thread-999');
    expect(profiles[0]!.responseText).toBe('Booked slot');
  });

  it('loads validated config for a client profile', () => {
    manager.createProfile('beta_client', {
      TARGET_THREAD_ID: 'thread-12345',
      TRIGGER_PHRASES: 'fast book, slot now',
      HEALTH_PORT: '3005',
    });

    const config = manager.loadConfigForClient('beta_client');
    expect(config.CLIENT_NAME).toBe('beta_client');
    expect(config.TARGET_THREAD_ID).toBe('thread-12345');
    expect(config.TRIGGER_PHRASES).toEqual(['fast book', 'slot now']);
    expect(config.HEALTH_PORT).toBe(3005);
    expect(config.APP_STATE_PATH).toContain('appstate.json');
  });

  it('generates PM2 ecosystem configuration for all clients', () => {
    manager.createProfile('client_one');
    manager.createProfile('client_two');

    const profiles = manager.listProfiles();
    expect(profiles).toHaveLength(2);

    const table = ClientManager.formatProfileTable(profiles);
    expect(table).toContain('client_one');
    expect(table).toContain('client_two');
  });
});

describe('HitLogger', () => {
  let tempDir: string;
  let hitLogPath: string;
  let logger: HitLogger;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hit-logger-test-'));
    hitLogPath = join(tempDir, 'hits.jsonl');
    logger = new HitLogger(hitLogPath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('records, persists, and reads hit records from JSONL', () => {
    const record1: HitRecord = {
      id: 'evt-001',
      clientName: 'Client Alpha',
      timestamp: '2026-08-16T03:55:00.000Z',
      epochMs: 1786823700000,
      threadId: 'thread-001',
      senderId: 'admin-001',
      triggerPhrase: 'open book',
      responseText: 'Me down',
      reactionTimeMs: 23.4,
      status: 'SUCCESS',
    };

    const record2: HitRecord = {
      id: 'evt-002',
      clientName: 'Client Beta',
      timestamp: '2026-08-16T03:56:00.000Z',
      epochMs: 1786823760000,
      threadId: 'thread-001',
      senderId: 'admin-001',
      triggerPhrase: 'open book',
      responseText: 'I am here',
      reactionTimeMs: 18.2,
      status: 'SUCCESS',
    };

    logger.recordHit(record1);
    logger.recordHit(record2);

    const saved = logger.readHits();
    expect(saved).toHaveLength(2);
    expect(saved[0]!.id).toBe('evt-001');
    expect(saved[1]!.id).toBe('evt-002');

    const leaderboard = HitLogger.formatLeaderboard(saved);
    expect(leaderboard).toContain('#1');
    expect(leaderboard).toContain('Client Beta'); // 18.2ms should be #1
    expect(leaderboard).toContain('Client Alpha'); // 23.4ms should be #2
  });
});
