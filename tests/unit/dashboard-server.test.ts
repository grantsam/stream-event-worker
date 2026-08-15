import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DashboardServer } from '../../src/infrastructure/dashboard/dashboard-server.js';

describe('DashboardServer', () => {
  let tempDir: string;
  let server: DashboardServer;
  let port: number;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dashboard-server-test-'));
    server = new DashboardServer('127.0.0.1', 0, tempDir);
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('serves dashboard index.html on GET /', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('CHAT SNIPER');
  });

  it('lists empty clients on GET /api/clients initially', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/clients`, {
      headers: { 'x-admin-key': 'apex_admin' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it('creates and configures client via POST /api/clients', async () => {
    const cookies = [
      { key: 'c_user', value: '112233', domain: '.facebook.com', path: '/' },
      {
        key: 'xs',
        value: 'secret-xs-token',
        domain: '.facebook.com',
        path: '/',
      },
    ];

    const createRes = await fetch(`http://127.0.0.1:${port}/api/clients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': 'apex_admin',
      },
      body: JSON.stringify({
        name: 'samuel_vip',
        targetThreadId: '28798413846428584',
        authorizedSenderIds: '100005890597158',
        triggerPhrases: 'open book',
        responseText: 'Me down',
        appstate: JSON.stringify(cookies),
      }),
    });

    expect(createRes.status).toBe(200);
    const createData = await createRes.json();
    expect(createData.success).toBe(true);
    expect(createData.clientName).toBe('samuel_vip');

    // Verify it appears in GET /api/clients
    const listRes = await fetch(`http://127.0.0.1:${port}/api/clients`, {
      headers: { 'x-admin-key': 'apex_admin' },
    });
    const clients = await listRes.json();
    expect(clients).toHaveLength(1);
    expect(clients[0].name).toBe('samuel_vip');
    expect(clients[0].hasCookies).toBe(true);
    expect(clients[0].isRunning).toBe(false);
  });

  it('returns leaderboard on GET /api/hits', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hits`, {
      headers: { 'x-admin-key': 'apex_admin' },
    });
    expect(res.status).toBe(200);
    const hits = await res.json();
    expect(Array.isArray(hits)).toBe(true);
  });
});
