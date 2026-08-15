import { createServer, type Server } from 'node:http';
import type { MessengerTransport } from '../../adapters/messenger/messenger-transport.js';

export interface ReadinessState {
  configValid: boolean;
  modeSupported: boolean;
  ruleEngineReady: boolean;
  persistenceReady?: boolean;
  shuttingDown: boolean;
}

export class HealthServer {
  private server: Server | undefined;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly state: ReadinessState,
    private readonly transport: MessengerTransport,
    private readonly metricsEnabled = false,
    private readonly metricsSnapshot?: () => object,
  ) {}

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.method !== 'GET') {
        response.statusCode = 405;
        response.end(JSON.stringify({ status: 'method_not_allowed' }));
        return;
      }
      if (request.url === '/healthz') {
        response.statusCode = 200;
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (request.url === '/readyz') {
        const transport = this.transport.health();
        const ready =
          this.state.configValid &&
          this.state.modeSupported &&
          this.state.ruleEngineReady &&
          this.state.persistenceReady !== false &&
          transport.connected &&
          !this.state.shuttingDown;
        response.statusCode = ready ? 200 : 503;
        response.end(
          JSON.stringify({
            status: ready ? 'ready' : 'not_ready',
            transport: transport.adapter,
          }),
        );
        return;
      }
      if (request.url === '/metrics' && this.metricsEnabled) {
        response.setHeader('cache-control', 'no-store');
        response.statusCode = 200;
        response.end(JSON.stringify(this.metricsSnapshot?.() ?? {}));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ status: 'not_found' }));
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, this.host, resolve);
    });
  }

  address(): { host: string; port: number } {
    const address = this.server?.address();
    if (!address || typeof address === 'string')
      throw new Error('Health server is not listening');
    return { host: this.host, port: address.port };
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server?.close((error) => (error ? reject(error) : resolve())),
    );
    this.server = undefined;
  }
}
