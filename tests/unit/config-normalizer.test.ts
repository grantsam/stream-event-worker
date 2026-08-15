import { describe, expect, it } from 'vitest';
import { normalizeMessage } from '../../src/domain/rules/message-normalizer.js';
import {
  loadConfig,
  parseActiveWindows,
} from '../../src/infrastructure/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  APP_MODE: 'dry-run',
  LOG_LEVEL: 'silent',
  TRANSPORT_ADAPTER: 'mock',
  TIMEZONE: 'Asia/Jakarta',
  TARGET_THREAD_ID: 'thread-test-001',
  AUTHORIZED_SENDER_IDS: 'admin-test-001',
  TRIGGER_PHRASES: 'open book,books open',
  RESPONSE_TEXT: 'Me down',
  ACTIVE_WINDOWS: 'MON-SUN@00:00-23:59',
  COOLDOWN_MS: '300000',
  MAX_EVENT_AGE_MS: '10000',
  HEALTH_HOST: '127.0.0.1',
  HEALTH_PORT: '0',
  METRICS_ENABLED: 'false',
};

describe('configuration and normalization', () => {
  it('loads supported dry-run mock configuration', () => {
    expect(loadConfig(validEnv).AUTHORIZED_SENDER_IDS).toEqual([
      'admin-test-001',
    ]);
  });

  it('loads supported live-session configuration', () => {
    const config = loadConfig({
      ...validEnv,
      APP_MODE: 'live',
      TRANSPORT_ADAPTER: 'live-session',
      APP_STATE_PATH: './data/custom-appstate.json',
      TYPING_DELAY_MS: '200',
      SIMULATE_TYPING: 'true',
    });
    expect(config.APP_MODE).toBe('live');
    expect(config.TRANSPORT_ADAPTER).toBe('live-session');
    expect(config.APP_STATE_PATH).toBe('./data/custom-appstate.json');
    expect(config.TYPING_DELAY_MS).toBe(200);
    expect(config.SIMULATE_TYPING).toBe(true);
  });

  it('rejects unsupported modes and malformed schedules', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        APP_MODE: 'invalid-mode' as unknown as 'dry-run',
      }),
    ).toThrow('Invalid environment configuration');
    expect(() =>
      loadConfig({
        ...validEnv,
        TRANSPORT_ADAPTER: 'invalid-transport' as unknown as 'mock',
      }),
    ).toThrow('Invalid environment configuration');
    expect(() => parseActiveWindows('MON@25:00-26:00')).toThrow(
      'Invalid ACTIVE_WINDOWS',
    );
  });

  it('normalizes Unicode, case, whitespace, and terminal punctuation', () => {
    expect(normalizeMessage('  OPEN   BOOK!!! ')).toBe('open book');
    expect(normalizeMessage('ｏｐｅｎ　ｂｏｏｋ。')).toBe('open book');
    expect(normalizeMessage('belum open book')).toBe('belum open book');
  });
});
