import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClientManager } from '../../src/app/client-manager.js';
import {
  DashboardServer,
  safeStringCompare,
} from '../../src/infrastructure/dashboard/dashboard-server.js';

describe('Dashboard Security & Role-Based Access Control', () => {
  let tempDir: string;
  let server: DashboardServer;
  let clientManager: ClientManager;
  let port: number;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    clientManager = new ClientManager(tempDir);
    server = new DashboardServer('127.0.0.1', 0, tempDir, 'test_secret_pass');
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('verifies constant-time safeStringCompare function', () => {
    expect(safeStringCompare('secret123', 'secret123')).toBe(true);
    expect(safeStringCompare('secret123', 'secret124')).toBe(false);
    expect(safeStringCompare('short', 'longer_string')).toBe(false);
  });

  it('sets security headers on every response', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toBeDefined();
  });

  it('authenticates master admin with correct key', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: 'test_secret_pass' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.role).toBe('admin');
  });

  it('rejects invalid admin password with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: 'wrong_password' }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Invalid admin password');
  });

  it('authenticates client with name and pin', async () => {
    clientManager.createProfile('samuel_vip', { CLIENT_PIN: '9988' });

    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName: 'samuel_vip', pin: '9988' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.role).toBe('client');
    expect(data.clientName).toBe('samuel_vip');
  });

  it('enforces RBAC: Client A cannot view or stop Client B', async () => {
    clientManager.createProfile('client_a', { CLIENT_PIN: '1111' });
    clientManager.createProfile('client_b', { CLIENT_PIN: '2222' });

    // Client A trying to stop Client B -> 403 Forbidden
    const stopRes = await fetch(
      `http://127.0.0.1:${port}/api/clients/client_b/stop?portal=client_a&pin=1111`,
      { method: 'POST' },
    );
    expect(stopRes.status).toBe(403);

    // Client A trying to view Client B portal -> 403 Forbidden
    const portalRes = await fetch(
      `http://127.0.0.1:${port}/api/portal/client_b?portal=client_a&pin=1111`,
    );
    expect(portalRes.status).toBe(403);

    // Client A accessing their own portal -> 200 OK
    const ownRes = await fetch(
      `http://127.0.0.1:${port}/api/portal/client_a?portal=client_a&pin=1111`,
    );
    expect(ownRes.status).toBe(200);
  });

  it('blocks guest access to protected endpoints with 401', async () => {
    const listRes = await fetch(`http://127.0.0.1:${port}/api/clients`);
    expect(listRes.status).toBe(401);

    const hitsRes = await fetch(`http://127.0.0.1:${port}/api/hits`);
    expect(hitsRes.status).toBe(401);
  });

  it('restricts hit verdict and clear history strictly to Admin', async () => {
    clientManager.createProfile('client_a', { CLIENT_PIN: '1111' });

    // Client tries to clear hits -> 403 Forbidden
    const clearRes = await fetch(
      `http://127.0.0.1:${port}/api/hits?portal=client_a&pin=1111`,
      { method: 'DELETE' },
    );
    expect(clearRes.status).toBe(403);

    // Admin clears hits -> 200 OK
    const adminClearRes = await fetch(
      `http://127.0.0.1:${port}/api/hits?key=test_secret_pass`,
      { method: 'DELETE' },
    );
    expect(adminClearRes.status).toBe(200);
  });

  it('rate limits brute-force login attempts (429 Too Many Requests)', async () => {
    for (let i = 0; i < 10; i++) {
      await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: 'wrong_key' }),
      });
    }

    // 11th attempt should trigger 429
    const limitedRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: 'wrong_key' }),
    });

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers.get('retry-after')).toBeDefined();
  });

  it('allows single hit row deletion via DELETE /api/hits/:id', async () => {
    const profile = clientManager.createProfile('samuel_row_test', {
      CLIENT_PIN: '3333',
    });
    const logger = new (
      await import('../../src/infrastructure/logging/hit-logger.js')
    ).HitLogger(join(profile.profileDir, 'data', 'hits.jsonl'));
    logger.recordHit({
      id: 'hit-test-delete-1',
      clientName: 'samuel_row_test',
      triggerPhrase: 'open book',
      threadId: 't1',
      senderId: 's1',
      responseText: 'Me down',
      reactionTimeMs: 15.2,
      timestamp: new Date().toISOString(),
      epochMs: Date.now(),
      status: 'SUCCESS',
    });

    expect(logger.readHits()).toHaveLength(1);

    // Delete single row as admin
    const delRes = await fetch(
      `http://127.0.0.1:${port}/api/hits/hit-test-delete-1?key=test_secret_pass`,
      { method: 'DELETE' },
    );
    expect(delRes.status).toBe(200);
    expect(logger.readHits()).toHaveLength(0);
  });

  it('allows single hit row editing via POST /api/hits/:id/edit', async () => {
    const profile = clientManager.createProfile('samuel_edit_test', {
      CLIENT_PIN: '3333',
    });
    const logger = new (
      await import('../../src/infrastructure/logging/hit-logger.js')
    ).HitLogger(join(profile.profileDir, 'data', 'hits.jsonl'));
    logger.recordHit({
      id: 'hit-test-edit-1',
      clientName: 'samuel_edit_test',
      triggerPhrase: 'open book',
      threadId: 't1',
      senderId: 's1',
      responseText: 'Me down',
      reactionTimeMs: 15.2,
      timestamp: new Date().toISOString(),
      epochMs: Date.now(),
      status: 'SUCCESS',
    });

    // Edit as admin
    const editRes = await fetch(
      `http://127.0.0.1:${port}/api/hits/hit-test-edit-1/edit?key=test_secret_pass`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'CONFIRMED_WIN',
          slotNumber: 1,
          notes: 'Stream confirmed',
        }),
      },
    );
    expect(editRes.status).toBe(200);

    const updated = logger.readHits()[0];
    expect(updated?.adminDecision).toBe('CONFIRMED_WIN');
    expect(updated?.adminSlotNumber).toBe(1);
    expect(updated?.adminNotes).toBe('Stream confirmed');
  });
});
