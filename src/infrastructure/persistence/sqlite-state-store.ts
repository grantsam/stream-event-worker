import { createHash } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IdempotencyStore } from '../../domain/idempotency/idempotency-store.js';
import type { OpenBookSessionManager } from '../../domain/session/open-book-session-manager.js';

const SCHEMA_VERSION = 1;
const CLEANUP_INTERVAL = 1_024;

export class SqliteStateStore
  implements IdempotencyStore, OpenBookSessionManager
{
  private readonly database: DatabaseSync;
  private readonly claimIdempotency;
  private readonly claimCooldownStatement;
  private readonly cleanupIdempotency;
  private readonly cleanupCooldown;
  private claimsSinceCleanup = 0;
  private closed = false;

  constructor(path: string) {
    const databasePath = resolveDatabasePath(path);
    mkdirSync(dirname(databasePath), { recursive: true });
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(databasePath, { timeout: 1_000 });
      this.database = database;
      this.migrate();
      this.assertIntegrity();
      this.claimIdempotency = database.prepare(`
        INSERT INTO idempotency_claims (fingerprint, expires_at_ms)
        VALUES (?, ?)
        ON CONFLICT (fingerprint) DO UPDATE SET expires_at_ms = excluded.expires_at_ms
        WHERE idempotency_claims.expires_at_ms <= ?
      `);
      this.claimCooldownStatement = database.prepare(`
        INSERT INTO cooldown_claims (scope_hash, available_at_ms)
        VALUES (?, ?)
        ON CONFLICT (scope_hash) DO UPDATE SET available_at_ms = excluded.available_at_ms
        WHERE cooldown_claims.available_at_ms <= ?
      `);
      this.cleanupIdempotency = database.prepare(
        'DELETE FROM idempotency_claims WHERE expires_at_ms <= ?',
      );
      this.cleanupCooldown = database.prepare(
        'DELETE FROM cooldown_claims WHERE available_at_ms <= ?',
      );
    } catch (error) {
      database?.close();
      throw error;
    }
  }

  claim(fingerprint: string, nowEpochMs: number, ttlMs: number): boolean {
    this.assertOpen();
    this.cleanup(nowEpochMs);
    return (
      this.claimIdempotency.run(fingerprint, nowEpochMs + ttlMs, nowEpochMs)
        .changes === 1
    );
  }

  claimCooldown(
    scope: string,
    nowEpochMs: number,
    cooldownMs: number,
  ): boolean {
    this.assertOpen();
    this.cleanup(nowEpochMs);
    return (
      this.claimCooldownStatement.run(
        hashScope(scope),
        nowEpochMs + cooldownMs,
        nowEpochMs,
      ).changes === 1
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private migrate(): void {
    const row = this.database.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (row.user_version > SCHEMA_VERSION) {
      throw new Error(`Unsupported SQLite schema version: ${row.user_version}`);
    }
    if (row.user_version === SCHEMA_VERSION) return;

    this.database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS idempotency_claims (
        fingerprint TEXT PRIMARY KEY,
        expires_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idempotency_claims_expiry_idx
        ON idempotency_claims (expires_at_ms);
      CREATE TABLE IF NOT EXISTS cooldown_claims (
        scope_hash TEXT PRIMARY KEY,
        available_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS cooldown_claims_availability_idx
        ON cooldown_claims (available_at_ms);
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  }

  private assertIntegrity(): void {
    const result = this.database.prepare('PRAGMA quick_check').get() as {
      quick_check: string;
    };
    if (result.quick_check !== 'ok') {
      throw new Error('SQLite integrity check failed');
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('SQLite state store is closed');
  }

  private cleanup(nowEpochMs: number): void {
    if (++this.claimsSinceCleanup < CLEANUP_INTERVAL) return;
    this.claimsSinceCleanup = 0;
    this.cleanupIdempotency.run(nowEpochMs);
    this.cleanupCooldown.run(nowEpochMs);
  }
}

function resolveDatabasePath(path: string): string {
  if (
    !path ||
    path.includes('\0') ||
    path === ':memory:' ||
    path.startsWith('file:')
  ) {
    throw new Error('STATE_DB_PATH must be a local filesystem path');
  }
  const databasePath = resolve(path);
  if (databasePath === parse(databasePath).root) {
    throw new Error('STATE_DB_PATH cannot be a filesystem root');
  }
  try {
    if (statSync(databasePath).isDirectory()) {
      throw new Error('STATE_DB_PATH must name a file, not a directory');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return databasePath;
}

function hashScope(scope: string): string {
  return createHash('sha256').update(scope).digest('hex');
}
