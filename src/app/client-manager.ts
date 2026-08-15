import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAppState } from '../adapters/messenger/appstate-loader.js';
import { loadConfig, type AppConfig } from '../infrastructure/config/env.js';
import type { AdminDecision, HitRecord } from '../domain/events/hit-record.js';
import { HitLogger } from '../infrastructure/logging/hit-logger.js';

export interface ClientProfileSummary {
  name: string;
  pin: string;
  configPath: string;
  hasConfig: boolean;
  hasCookies: boolean;
  targetThreadId: string;
  triggerPhrases: string;
  responseText: string;
  healthPort: number;
  totalHits: number;
}

export class ClientManager {
  constructor(private readonly clientsRoot = 'clients') {
    mkdirSync(resolve(this.clientsRoot), { recursive: true });
  }

  createProfile(
    clientName: string,
    overrides: Partial<Record<string, string>> = {},
  ): {
    profileDir: string;
    configPath: string;
    appStatePath: string;
    pin: string;
  } {
    const sanitized = clientName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    if (!sanitized) {
      throw new Error(
        `Invalid client name: "${clientName}". Use alphanumeric characters, dashes, or underscores.`,
      );
    }

    const profileDir = resolve(this.clientsRoot, sanitized);
    const dataDir = join(profileDir, 'data');
    const configPath = join(profileDir, 'client.env');
    const appStatePath = join(profileDir, 'appstate.json');
    const pin =
      overrides.CLIENT_PIN ?? String(Math.floor(1000 + Math.random() * 9000));

    mkdirSync(dataDir, { recursive: true });

    if (!existsSync(configPath)) {
      const defaultEnv = [
        'NODE_ENV=production',
        'LOG_LEVEL=info',
        'APP_MODE=live',
        'TRANSPORT_ADAPTER=live-session',
        `CLIENT_NAME=${sanitized}`,
        `CLIENT_PIN=${pin}`,
        '',
        `TARGET_THREAD_ID=${overrides.TARGET_THREAD_ID ?? '28798413846428584'}`,
        `AUTHORIZED_SENDER_IDS=${overrides.AUTHORIZED_SENDER_IDS ?? '100005890597158'}`,
        '',
        `TRIGGER_PHRASES=${overrides.TRIGGER_PHRASES ?? 'open book'}`,
        `RESPONSE_TEXT=${overrides.RESPONSE_TEXT ?? 'Me down'}`,
        '',
        'TIMEZONE=Asia/Jakarta',
        'ACTIVE_WINDOWS=MON-SUN@00:00-23:59',
        'COOLDOWN_MS=5000',
        'MAX_EVENT_AGE_MS=10000',
        '',
        'HEALTH_HOST=127.0.0.1',
        `HEALTH_PORT=${overrides.HEALTH_PORT ?? '3001'}`,
        '',
        `APP_STATE_PATH=./clients/${sanitized}/appstate.json`,
        `STATE_DB_PATH=./clients/${sanitized}/data/worker.sqlite`,
        `HITS_LOG_PATH=./clients/${sanitized}/data/hits.jsonl`,
        '',
        'SIMULATE_TYPING=true',
        'TYPING_DELAY_MS=150',
        'METRICS_ENABLED=false',
        '',
      ].join('\n');

      writeFileSync(configPath, defaultEnv, 'utf8');
    }

    if (!existsSync(appStatePath)) {
      writeFileSync(appStatePath, '[]', 'utf8');
    }

    return { profileDir, configPath, appStatePath, pin };
  }

  loadConfigForClient(clientName: string): AppConfig {
    const sanitized = clientName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    const profileDir = resolve(this.clientsRoot, sanitized);
    const configPath = join(profileDir, 'client.env');

    if (!existsSync(configPath)) {
      throw new Error(
        `Client profile "${sanitized}" not found at ${configPath}. Run "npm run client:create -- ${sanitized}" to create it.`,
      );
    }

    const envMap: Record<string, string> = {
      CLIENT_NAME: sanitized,
      APP_STATE_PATH: join('clients', sanitized, 'appstate.json'),
      STATE_DB_PATH: join('clients', sanitized, 'data', 'worker.sqlite'),
      HITS_LOG_PATH: join('clients', sanitized, 'data', 'hits.jsonl'),
    };

    const raw = readFileSync(configPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        envMap[key] = val;
      }
    }

    return loadConfig(envMap);
  }

  listProfiles(): ClientProfileSummary[] {
    const root = resolve(this.clientsRoot);
    if (!existsSync(root)) return [];

    const entries = readdirSync(root, { withFileTypes: true });
    const summaries: ClientProfileSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const clientName = entry.name;
      const profileDir = join(root, clientName);
      const configPath = join(profileDir, 'client.env');
      const appStatePath = join(profileDir, 'appstate.json');
      const hitsPath = join(profileDir, 'data', 'hits.jsonl');

      const hasConfig = existsSync(configPath);
      let hasCookies = false;
      let targetThreadId = 'N/A';
      let triggerPhrases = 'N/A';
      let responseText = 'N/A';
      let pin = '1234';
      let healthPort = 3000;
      let totalHits = 0;

      if (existsSync(appStatePath)) {
        try {
          const res = loadAppState(appStatePath);
          hasCookies = res.cookies.length > 0;
        } catch {
          hasCookies = false;
        }
      }

      if (hasConfig) {
        try {
          const cfg = this.loadConfigForClient(clientName);
          targetThreadId = cfg.TARGET_THREAD_ID;
          triggerPhrases = cfg.TRIGGER_PHRASES.join(', ');
          responseText = cfg.RESPONSE_TEXT;
          healthPort = cfg.HEALTH_PORT;
          pin = cfg.CLIENT_PIN;
        } catch {
          // Config parse issue
        }
      }

      if (existsSync(hitsPath)) {
        const logger = new HitLogger(hitsPath);
        totalHits = logger.readHits().length;
      }

      summaries.push({
        name: clientName,
        pin,
        configPath,
        hasConfig,
        hasCookies,
        targetThreadId,
        triggerPhrases,
        responseText,
        healthPort,
        totalHits,
      });
    }

    return summaries;
  }

  getClientProfile(clientName: string): ClientProfileSummary | null {
    const profiles = this.listProfiles();
    const sanitized = clientName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    return profiles.find((p) => p.name === sanitized) ?? null;
  }

  validateClientPin(clientName: string, pin: string): boolean {
    const profile = this.getClientProfile(clientName);
    if (!profile) return false;
    return profile.pin.trim() === pin.trim();
  }

  getAllHits(clientName?: string): HitRecord[] {
    if (clientName) {
      const sanitized = clientName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');
      const hitsPath = resolve(
        this.clientsRoot,
        sanitized,
        'data',
        'hits.jsonl',
      );
      return new HitLogger(hitsPath).readHits();
    }

    const allHits: HitRecord[] = [];
    const defaultHits = resolve('data', 'hits.jsonl');
    if (existsSync(defaultHits)) {
      allHits.push(...new HitLogger(defaultHits).readHits());
    }

    const profiles = this.listProfiles();
    for (const p of profiles) {
      const pPath = resolve(this.clientsRoot, p.name, 'data', 'hits.jsonl');
      if (existsSync(pPath)) {
        allHits.push(...new HitLogger(pPath).readHits());
      }
    }

    return allHits;
  }

  clearAllHits(clientName?: string): void {
    if (clientName) {
      const sanitized = clientName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');
      const hitsPath = resolve(
        this.clientsRoot,
        sanitized,
        'data',
        'hits.jsonl',
      );
      if (existsSync(hitsPath)) {
        writeFileSync(hitsPath, '', 'utf8');
      }
      return;
    }

    const defaultHits = resolve('data', 'hits.jsonl');
    if (existsSync(defaultHits)) {
      writeFileSync(defaultHits, '', 'utf8');
    }

    const profiles = this.listProfiles();
    for (const p of profiles) {
      const pPath = resolve(this.clientsRoot, p.name, 'data', 'hits.jsonl');
      if (existsSync(pPath)) {
        writeFileSync(pPath, '', 'utf8');
      }
    }
  }

  updateHitVerdict(
    hitId: string,
    decision: AdminDecision,
    slotNumber?: number | null,
    notes?: string,
  ): boolean {
    const defaultHits = resolve('data', 'hits.jsonl');
    if (existsSync(defaultHits)) {
      const logger = new HitLogger(defaultHits);
      if (logger.updateVerdict(hitId, decision, slotNumber, notes)) {
        return true;
      }
    }

    const profiles = this.listProfiles();
    for (const p of profiles) {
      const pPath = resolve(this.clientsRoot, p.name, 'data', 'hits.jsonl');
      if (existsSync(pPath)) {
        const logger = new HitLogger(pPath);
        if (logger.updateVerdict(hitId, decision, slotNumber, notes)) {
          return true;
        }
      }
    }

    return false;
  }

  deleteHit(hitId: string, clientName?: string): boolean {
    if (clientName) {
      const sanitized = clientName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');
      const pPath = resolve(this.clientsRoot, sanitized, 'data', 'hits.jsonl');
      if (existsSync(pPath)) {
        return new HitLogger(pPath).deleteHit(hitId);
      }
      return false;
    }

    const defaultHits = resolve('data', 'hits.jsonl');
    if (existsSync(defaultHits)) {
      const logger = new HitLogger(defaultHits);
      if (logger.deleteHit(hitId)) return true;
    }

    const profiles = this.listProfiles();
    for (const p of profiles) {
      const pPath = resolve(this.clientsRoot, p.name, 'data', 'hits.jsonl');
      if (existsSync(pPath)) {
        const logger = new HitLogger(pPath);
        if (logger.deleteHit(hitId)) return true;
      }
    }

    return false;
  }

  static formatProfileTable(profiles: ClientProfileSummary[]): string {
    if (profiles.length === 0) {
      return 'No client profiles configured yet. Create one with: npm run client:create <client_name>';
    }

    const rows = [
      '┌──────────────────────┬─────────────┬─────────────┬────────────────────┬──────────┬───────────┐',
      '│ Client Name          │ Cookies OK? │ Config OK?  │ Target Thread ID   │ Port     │ Hits Won  │',
      '├──────────────────────┼─────────────┼─────────────┼────────────────────┼──────────┼───────────┤',
    ];

    for (const p of profiles) {
      const name = p.name.padEnd(20);
      const cookies = (p.hasCookies ? '✔ Ready' : '✖ Missing').padEnd(11);
      const config = (p.hasConfig ? '✔ Ready' : '✖ Missing').padEnd(11);
      const thread = p.targetThreadId.slice(0, 18).padEnd(18);
      const port = String(p.healthPort).padEnd(8);
      const hits = String(p.totalHits).padEnd(9);
      rows.push(
        `│ ${name} │ ${cookies} │ ${config} │ ${thread} │ ${port} │ ${hits} │`,
      );
    }

    rows.push(
      '└──────────────────────┴─────────────┴─────────────┴────────────────────┴──────────┴───────────┘',
    );
    return rows.join('\n');
  }

  generatePm2Config(): string {
    const profiles = this.listProfiles();
    const apps = profiles.map((p) => ({
      name: `worker-${p.name}`,
      script: 'dist/src/index.js',
      args: `--client ${p.name}`,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
    }));

    const configContent = `module.exports = {\n  apps: ${JSON.stringify(apps, null, 2)}\n};\n`;
    const targetFile = resolve('ecosystem.config.cjs');
    writeFileSync(targetFile, configContent, 'utf8');
    return targetFile;
  }
}
