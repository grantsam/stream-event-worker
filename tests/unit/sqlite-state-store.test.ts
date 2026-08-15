import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStateStore } from '../../src/infrastructure/persistence/sqlite-state-store.js';

const directories: string[] = [];
function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'open-book-state-'));
  directories.push(directory);
  return join(directory, 'worker.sqlite');
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SqliteStateStore', () => {
  it('claims dedupe/cooldown atomically and allows exact expiry', () => {
    const store = new SqliteStateStore(databasePath());
    expect(store.claim('fingerprint', 1_000, 100)).toBe(true);
    expect(store.claim('fingerprint', 1_099, 100)).toBe(false);
    expect(store.claim('fingerprint', 1_100, 100)).toBe(true);
    expect(store.claimCooldown('thread-test-001', 1_000, 100)).toBe(true);
    expect(store.claimCooldown('thread-test-001', 1_099, 100)).toBe(false);
    expect(store.claimCooldown('thread-test-001', 1_100, 100)).toBe(true);
    store.close();
  });

  it('persists claims across close and reopen without raw scope storage', async () => {
    const path = databasePath();
    const first = new SqliteStateStore(path);
    expect(first.claim('fingerprint', 1_000, 100)).toBe(true);
    expect(first.claimCooldown('thread-test-001', 1_000, 100)).toBe(true);
    first.close();

    const second = new SqliteStateStore(path);
    const outcomes = await Promise.all([
      Promise.resolve(second.claim('fingerprint', 1_050, 100)),
      Promise.resolve(second.claim('fingerprint', 1_050, 100)),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(0);
    expect(second.claimCooldown('thread-test-001', 1_050, 100)).toBe(false);
    expect(second.claim('fingerprint', 1_100, 100)).toBe(true);
    expect(second.claimCooldown('thread-test-001', 1_100, 100)).toBe(true);
    second.close();

    const bytes = readFileSync(path, 'utf8');
    expect(bytes).not.toContain('thread-test-001');
  });

  it('creates parent directories and rejects unsafe paths', () => {
    const path = join(databasePath(), '..', 'nested', 'worker.sqlite');
    const store = new SqliteStateStore(path);
    expect(store.claim('fingerprint', 1, 1)).toBe(true);
    store.close();
    expect(() => new SqliteStateStore(':memory:')).toThrow('STATE_DB_PATH');
    expect(() => new SqliteStateStore('file:worker.sqlite')).toThrow(
      'STATE_DB_PATH',
    );
  });

  it('fails closed on a corrupt temporary database without replacing it', () => {
    const path = databasePath();
    writeFileSync(path, 'not a sqlite database');
    expect(() => new SqliteStateStore(path)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('not a sqlite database');
  });

  it('cannot claim after close', () => {
    const store = new SqliteStateStore(databasePath());
    store.close();
    expect(() => store.claim('fingerprint', 1, 1)).toThrow('closed');
  });
});
