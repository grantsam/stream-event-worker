import { bootstrap } from './app/bootstrap.js';
import { ClientManager } from './app/client-manager.js';
import { parseArgs, runFixture, runStream } from './app/fixture-replay.js';
import {
  parsePerformanceArgs,
  runPerformanceHarness,
} from './app/local-benchmark.js';
import { runDurableRestartRegression } from './app/local-regression.js';
import type { AppConfig } from './infrastructure/config/env.js';
import { DashboardServer } from './infrastructure/dashboard/dashboard-server.js';
import { HitLogger } from './infrastructure/logging/hit-logger.js';

async function runDaemon(customConfig?: AppConfig): Promise<void> {
  const app = await bootstrap(customConfig ? { config: customConfig } : {});
  let stopping = false;
  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    try {
      await app.shutdown();
      process.exitCode = 0;
    } catch (error) {
      console.error(`Shutdown failed after ${signal}`, error);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));
}

async function withAbort<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    return await operation(controller.signal);
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

async function runStdin(): Promise<void> {
  await withAbort((signal) =>
    runStream(process.stdin, process.stdout, process.env, { signal }),
  );
}

try {
  const args = process.argv.slice(2);
  const clientManager = new ClientManager();

  if (args[0] === '--create-client') {
    const clientName = args[1];
    if (!clientName) {
      console.error('Usage: npm run client:create <client_name>');
      process.exitCode = 1;
    } else {
      const created = clientManager.createProfile(clientName);
      console.log(`\n✔ Created client profile: "${clientName}"`);
      console.log(`  📁 Profile folder: ${created.profileDir}`);
      console.log(`  ⚙️  Config file:    ${created.configPath}`);
      console.log(`  🍪 Cookies file:   ${created.appStatePath}`);
      console.log('\nNext steps:');
      console.log(
        ` 1. Paste the client's cookies into: ${created.appStatePath}`,
      );
      console.log(
        ` 2. Adjust target thread/triggers in: ${created.configPath}`,
      );
      console.log(` 3. Start this client: npm run client -- ${clientName}\n`);
    }
  } else if (args[0] === '--list-clients') {
    const profiles = clientManager.listProfiles();
    console.log('\n' + ClientManager.formatProfileTable(profiles) + '\n');
  } else if (args[0] === '--hits' || args[0] === '--leaderboard') {
    const clientFilter = args[1];
    const hits = clientManager.getAllHits(clientFilter);
    console.log('\n⚡ FASTEST WIN / HIT LEADERBOARD');
    console.log(HitLogger.formatLeaderboard(hits) + '\n');
  } else if (args[0] === '--pm2') {
    const filePath = clientManager.generatePm2Config();
    console.log(`\n✔ Generated PM2 config: ${filePath}`);
    console.log(
      'Run all clients in parallel with: pm2 start ecosystem.config.cjs\n',
    );
  } else if (args[0] === '--dashboard') {
    const port = Number(process.env.DASHBOARD_PORT ?? process.env.PORT ?? 3000);
    const host = process.env.DASHBOARD_HOST ?? '0.0.0.0';
    const server = new DashboardServer(host, port);
    const actualPort = await server.start();
    console.log(`\n⚡ APEX CHAT DASHBOARD IS LIVE!`);
    console.log(`  🌐 Local URL:   http://localhost:${actualPort}`);
    console.log(`  🌐 Network URL: http://${host}:${actualPort}\n`);
    const stop = async () => {
      await server.stop();
      process.exitCode = 0;
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
  } else if (args[0] === '--client') {
    const clientName = args[1];
    if (!clientName) {
      console.error('Usage: npm run client -- <client_name>');
      process.exitCode = 1;
    } else {
      const clientConfig = clientManager.loadConfigForClient(clientName);
      console.log(
        `\n🚀 Starting worker for client profile: "${clientName}" (Port ${clientConfig.HEALTH_PORT})...`,
      );
      await runDaemon(clientConfig);
    }
  } else if (args[0] === '--benchmark' || args[0] === '--soak') {
    const summary = await withAbort((signal) =>
      runPerformanceHarness(parsePerformanceArgs(args), signal),
    );
    console.log(JSON.stringify(summary));
  } else if (args[0] === '--regression' && args.length === 1) {
    console.log(JSON.stringify(await runDurableRestartRegression()));
  } else {
    const command = parseArgs(args);
    if (command.mode === 'fixture') {
      console.log(JSON.stringify(await runFixture(command.path)));
    } else if (command.mode === 'stream') {
      await runStdin();
    } else {
      await runDaemon();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Startup failed');
  process.exitCode = 1;
}
