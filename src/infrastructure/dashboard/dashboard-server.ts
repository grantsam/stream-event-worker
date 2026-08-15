import { fork, type ChildProcess } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { resolve } from 'node:path';
import { ClientManager } from '../../app/client-manager.js';

export interface RunningClientProcess {
  process: ChildProcess;
  startedAt: number;
  logs: string[];
}

export type AuthContext =
  | { role: 'admin' }
  | { role: 'client'; clientName: string }
  | { role: 'guest' };

/**
 * In-memory sliding window rate limiter
 */
export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  check(
    ip: string,
    limit = 10,
    windowMs = 60_000,
  ): { allowed: boolean; retryAfterSec?: number } {
    const now = Date.now();
    const timestamps = (this.attempts.get(ip) ?? []).filter(
      (t) => now - t < windowMs,
    );

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] ?? now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + windowMs - now) / 1000),
      );
      this.attempts.set(ip, timestamps);
      return { allowed: false, retryAfterSec };
    }

    timestamps.push(now);
    this.attempts.set(ip, timestamps);
    return { allowed: true };
  }

  reset(ip: string): void {
    this.attempts.delete(ip);
  }
}

/**
 * Constant-time string comparison to prevent side-channel timing attacks
 */
export function safeStringCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform dummy constant-time check to prevent timing leaks
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export class DashboardServer {
  private server: Server | undefined;
  private readonly runningProcesses = new Map<string, RunningClientProcess>();
  private readonly clientManager: ClientManager;
  private readonly rateLimiter = new RateLimiter();

  constructor(
    private readonly host = '0.0.0.0',
    private readonly port = 3000,
    private readonly clientsRoot = 'clients',
    private readonly adminKey = process.env.ADMIN_KEY ?? 'apex_admin',
  ) {
    this.clientManager = new ClientManager(this.clientsRoot);
  }

  async start(): Promise<number> {
    return new Promise((resolvePromise, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error('Dashboard request error:', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({
                error:
                  err instanceof Error ? err.message : 'Internal Server Error',
              }),
            );
          }
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address();
        const actualPort =
          typeof address === 'object' && address ? address.port : this.port;
        resolvePromise(actualPort);
      });
    });
  }

  async stop(): Promise<void> {
    for (const [name, proc] of this.runningProcesses.entries()) {
      try {
        proc.process.kill('SIGTERM');
      } catch {
        // Ignored
      }
      this.runningProcesses.delete(name);
    }

    return new Promise((resolvePromise) => {
      if (this.server) {
        this.server.close(() => resolvePromise());
      } else {
        resolvePromise();
      }
    });
  }

  private authenticateRequest(req: IncomingMessage, url: URL): AuthContext {
    const adminKeyHeader = req.headers['x-admin-key'];
    const authHeader = req.headers['authorization'];
    const bearerKey = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
    const adminKeyParam =
      url.searchParams.get('key') ?? url.searchParams.get('adminKey');

    const candidateAdminKey =
      (typeof adminKeyHeader === 'string' && adminKeyHeader) ||
      bearerKey ||
      adminKeyParam;

    if (
      candidateAdminKey &&
      safeStringCompare(candidateAdminKey, this.adminKey)
    ) {
      return { role: 'admin' };
    }

    const clientPinHeader = req.headers['x-client-pin'];
    const clientNameHeader = req.headers['x-client-name'];
    const pinParam = url.searchParams.get('pin');
    const portalParam =
      url.searchParams.get('portal') ?? url.searchParams.get('client');

    const candidatePin =
      (typeof clientPinHeader === 'string' && clientPinHeader) || pinParam;
    const candidateClient =
      (typeof clientNameHeader === 'string' && clientNameHeader) || portalParam;

    if (candidateClient && candidatePin) {
      const sanitized = candidateClient
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');
      if (this.clientManager.validateClientPin(sanitized, candidatePin)) {
        return { role: 'client', clientName: sanitized };
      }
    }

    return { role: 'guest' };
  }

  private setSecurityHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, x-admin-key, x-client-pin, x-client-name, Authorization',
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    );
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    this.setSecurityHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? 'localhost'}`,
    );
    const pathname = url.pathname;
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      '127.0.0.1';

    if (pathname === '/' || pathname === '/index.html') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.statusCode = 200;
      res.end(this.getDashboardHtml());
      return;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const rateCheck = this.rateLimiter.check(clientIp, 10, 60_000);
      if (!rateCheck.allowed) {
        res.statusCode = 429;
        res.setHeader('content-type', 'application/json');
        res.setHeader('Retry-After', String(rateCheck.retryAfterSec ?? 60));
        res.end(
          JSON.stringify({
            error: `Too many login attempts. Please wait ${rateCheck.retryAfterSec}s before retrying.`,
          }),
        );
        return;
      }

      const body = await this.readJsonBody<{
        adminKey?: string;
        clientName?: string;
        pin?: string;
      }>(req);

      if (body.adminKey) {
        if (safeStringCompare(body.adminKey, this.adminKey)) {
          this.rateLimiter.reset(clientIp);
          res.setHeader('content-type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ success: true, role: 'admin' }));
          return;
        }
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid admin password' }));
        return;
      }

      if (body.clientName && body.pin) {
        const sanitized = body.clientName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '_');
        const valid = this.clientManager.validateClientPin(sanitized, body.pin);
        if (valid) {
          this.rateLimiter.reset(clientIp);
          res.setHeader('content-type', 'application/json');
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              success: true,
              role: 'client',
              clientName: sanitized,
            }),
          );
          return;
        }
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid client name or PIN' }));
        return;
      }

      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing credentials' }));
      return;
    }

    const auth = this.authenticateRequest(req, url);

    const portalMatch = /^\/api\/portal\/([^/]+)$/u.exec(pathname);
    if (portalMatch && req.method === 'GET') {
      const clientName = decodeURIComponent(portalMatch[1]!)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');

      const isAllowed =
        auth.role === 'admin' ||
        (auth.role === 'client' && auth.clientName === clientName);

      if (!isAllowed) {
        res.statusCode = auth.role === 'guest' ? 401 : 403;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error:
              auth.role === 'guest'
                ? 'Unauthorized'
                : 'Forbidden: You cannot view other clients',
          }),
        );
        return;
      }

      const profile = this.clientManager.getClientProfile(clientName);
      if (!profile) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Client not found' }));
        return;
      }

      const hits = this.clientManager.getAllHits(clientName);
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          profile: {
            ...profile,
            isRunning: this.runningProcesses.has(profile.name),
            startedAt:
              this.runningProcesses.get(profile.name)?.startedAt ?? null,
          },
          hits,
        }),
      );
      return;
    }

    if (pathname === '/api/clients' && req.method === 'GET') {
      if (auth.role === 'guest') {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const profiles =
        auth.role === 'admin'
          ? this.clientManager.listProfiles()
          : this.clientManager
              .listProfiles()
              .filter((p) => p.name === auth.clientName);

      const payload = profiles.map((p) => ({
        ...p,
        isRunning: this.runningProcesses.has(p.name),
        startedAt: this.runningProcesses.get(p.name)?.startedAt ?? null,
      }));
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify(payload));
      return;
    }

    if (pathname === '/api/clients' && req.method === 'POST') {
      if (auth.role === 'guest') {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const body = await this.readJsonBody<{
        name: string;
        targetThreadId?: string;
        authorizedSenderIds?: string;
        triggerPhrases?: string;
        responseText?: string;
        appstate?: string;
        typingDelayMs?: number;
      }>(req);

      if (!body.name || !body.name.trim()) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Client name is required' }));
        return;
      }

      const clientName = body.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');

      if (auth.role === 'client' && auth.clientName !== clientName) {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Forbidden: You cannot modify other client profiles',
          }),
        );
        return;
      }

      const profile = this.clientManager.createProfile(clientName, {
        TARGET_THREAD_ID: body.targetThreadId,
        AUTHORIZED_SENDER_IDS: body.authorizedSenderIds,
        TRIGGER_PHRASES: body.triggerPhrases,
        RESPONSE_TEXT: body.responseText,
        TYPING_DELAY_MS: body.typingDelayMs
          ? String(body.typingDelayMs)
          : undefined,
      });

      if (body.appstate && body.appstate.trim()) {
        const cookieJson = body.appstate.trim();
        try {
          const parsed = JSON.parse(cookieJson);
          if (!Array.isArray(parsed)) {
            throw new Error('Cookies must be an array of cookie objects');
          }
          writeFileSync(
            profile.appStatePath,
            JSON.stringify(parsed, null, 2),
            'utf8',
          );
        } catch (e) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              error: `Invalid cookie JSON: ${e instanceof Error ? e.message : String(e)}`,
            }),
          );
          return;
        }
      }

      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, clientName }));
      return;
    }

    const startMatch = /^\/api\/clients\/([^/]+)\/start$/u.exec(pathname);
    if (startMatch && req.method === 'POST') {
      const clientName = decodeURIComponent(startMatch[1]!)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');

      if (auth.role === 'guest') {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      if (auth.role === 'client' && auth.clientName !== clientName) {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Forbidden: You cannot control other client bots',
          }),
        );
        return;
      }

      const result = this.startClientProcess(clientName);
      res.setHeader('content-type', 'application/json');
      res.statusCode = result.success ? 200 : 400;
      res.end(JSON.stringify(result));
      return;
    }

    const stopMatch = /^\/api\/clients\/([^/]+)\/stop$/u.exec(pathname);
    if (stopMatch && req.method === 'POST') {
      const clientName = decodeURIComponent(stopMatch[1]!)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');

      if (auth.role === 'guest') {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      if (auth.role === 'client' && auth.clientName !== clientName) {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Forbidden: You cannot control other client bots',
          }),
        );
        return;
      }

      const result = this.stopClientProcess(clientName);
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/hits' && req.method === 'GET') {
      if (auth.role === 'guest') {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const clientParam =
        auth.role === 'client'
          ? auth.clientName
          : (url.searchParams.get('client') ?? undefined);

      const hits = this.clientManager.getAllHits(clientParam);
      const sorted = [...hits].sort(
        (a, b) => a.reactionTimeMs - b.reactionTimeMs,
      );
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify(sorted));
      return;
    }

    if (
      pathname === '/api/hits' &&
      (req.method === 'DELETE' || req.method === 'POST')
    ) {
      if (auth.role !== 'admin') {
        res.statusCode = auth.role === 'guest' ? 401 : 403;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Forbidden: Only Master Admin can clear hit records',
          }),
        );
        return;
      }

      const clientParam = url.searchParams.get('client') ?? undefined;
      this.clientManager.clearAllHits(clientParam);
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // API: Delete single hit record
    const deleteHitMatch = /^\/api\/hits\/([^/]+)$/u.exec(pathname);
    if (deleteHitMatch && req.method === 'DELETE') {
      if (auth.role === 'guest') {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const hitId = decodeURIComponent(deleteHitMatch[1]!);
      const clientScope = auth.role === 'client' ? auth.clientName : undefined;
      const success = this.clientManager.deleteHit(hitId, clientScope);

      res.setHeader('content-type', 'application/json');
      res.statusCode = success ? 200 : 404;
      res.end(JSON.stringify({ success }));
      return;
    }

    // API: Edit hit record / verdict
    const editHitMatch = /^\/api\/hits\/([^/]+)\/edit$/u.exec(pathname);
    if (editHitMatch && req.method === 'POST') {
      if (auth.role !== 'admin') {
        res.statusCode = auth.role === 'guest' ? 401 : 403;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Forbidden: Only Master Admin can edit hit records',
          }),
        );
        return;
      }

      const hitId = decodeURIComponent(editHitMatch[1]!);
      const body = await this.readJsonBody<{
        decision?: 'PENDING' | 'CONFIRMED_WIN' | 'MISSED' | 'DISPUTED';
        slotNumber?: number | null;
        notes?: string;
      }>(req);

      const success = this.clientManager.updateHitVerdict(
        hitId,
        body.decision ?? 'PENDING',
        body.slotNumber,
        body.notes,
      );

      res.setHeader('content-type', 'application/json');
      res.statusCode = success ? 200 : 404;
      res.end(JSON.stringify({ success }));
      return;
    }

    const verdictMatch = /^\/api\/hits\/([^/]+)\/verdict$/u.exec(pathname);
    if (verdictMatch && req.method === 'POST') {
      if (auth.role !== 'admin') {
        res.statusCode = auth.role === 'guest' ? 401 : 403;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Forbidden: Only Master Admin can assign official verdicts',
          }),
        );
        return;
      }

      const hitId = decodeURIComponent(verdictMatch[1]!);
      const body = await this.readJsonBody<{
        decision: 'PENDING' | 'CONFIRMED_WIN' | 'MISSED' | 'DISPUTED';
        slotNumber?: number | null;
        notes?: string;
      }>(req);

      const success = this.clientManager.updateHitVerdict(
        hitId,
        body.decision,
        body.slotNumber,
        body.notes,
      );
      res.setHeader('content-type', 'application/json');
      res.statusCode = success ? 200 : 404;
      res.end(JSON.stringify({ success }));
      return;
    }

    const raceMatch = /^\/api\/hits\/([^/]+)\/race$/u.exec(pathname);
    if (raceMatch && req.method === 'GET') {
      const hitId = decodeURIComponent(raceMatch[1]!);
      const hits = this.clientManager.getAllHits();
      const hit = hits.find((h) => h.id === hitId);
      if (!hit) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Hit not found' }));
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          hitId: hit.id,
          clientName: hit.clientName,
          ourRankInQueue: hit.ourRankInQueue ?? 1,
          totalContenders: hit.totalContenders ?? hit.contenders?.length ?? 1,
          timeAheadOfNextMs: hit.timeAheadOfNextMs ?? null,
          contenders: hit.contenders ?? [],
        }),
      );
      return;
    }

    const logMatch = /^\/api\/logs\/([^/]+)$/u.exec(pathname);
    if (logMatch && req.method === 'GET') {
      const clientName = decodeURIComponent(logMatch[1]!)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');

      if (auth.role === 'guest') {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      if (auth.role === 'client' && auth.clientName !== clientName) {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Forbidden: You cannot view other clients logs',
          }),
        );
        return;
      }

      const proc = this.runningProcesses.get(clientName);
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          clientName,
          isRunning: !!proc,
          logs: proc?.logs ?? [],
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  private startClientProcess(clientName: string): {
    success: boolean;
    error?: string;
  } {
    if (this.runningProcesses.has(clientName)) {
      return { success: true };
    }

    try {
      this.clientManager.loadConfigForClient(clientName);
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'Invalid client configuration',
      };
    }

    const scriptPath = resolve('dist/src/index.js');
    const child = fork(scriptPath, ['--client', clientName], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    const logBuffer: string[] = [];
    const pushLog = (data: Buffer) => {
      const lines = data.toString('utf8').split('\n');
      for (const line of lines) {
        if (line.trim()) {
          logBuffer.push(`[${new Date().toLocaleTimeString()}] ${line}`);
          if (logBuffer.length > 200) logBuffer.shift();
        }
      }
    };

    child.stdout?.on('data', pushLog);
    child.stderr?.on('data', pushLog);

    child.on('exit', (code) => {
      this.runningProcesses.delete(clientName);
      logBuffer.push(
        `[${new Date().toLocaleTimeString()}] Process exited with code ${code}`,
      );
    });

    this.runningProcesses.set(clientName, {
      process: child,
      startedAt: Date.now(),
      logs: logBuffer,
    });

    return { success: true };
  }

  private stopClientProcess(clientName: string): { success: boolean } {
    const proc = this.runningProcesses.get(clientName);
    if (proc) {
      try {
        proc.process.kill('SIGTERM');
      } catch {
        // Ignored
      }
      this.runningProcesses.delete(clientName);
    }
    return { success: true };
  }

  private async readJsonBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolvePromise, reject) => {
      let data = '';
      let bytes = 0;
      const MAX_BYTES = 512 * 1024;

      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          reject(new Error('Payload Too Large: Max size 512KB'));
          return;
        }
        data += chunk;
      });
      req.on('end', () => {
        try {
          resolvePromise(data ? JSON.parse(data) : ({} as T));
        } catch {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  private getDashboardHtml(): string {
    const publicPath = resolve(
      'src/infrastructure/dashboard/public/index.html',
    );
    if (existsSync(publicPath)) {
      return readFileSync(publicPath, 'utf8');
    }
    return `<!DOCTYPE html><html><head><title>Automation Chat Dashboard</title></head><body style="background:#111;color:#eee;font-family:sans-serif;padding:2rem;"><h2>Dashboard is loading...</h2></body></html>`;
  }
}
