import { bootstrap } from './app/bootstrap.js';
import { parseArgs, runFixture, runStream } from './app/fixture-replay.js';
import {
  parsePerformanceArgs,
  runPerformanceHarness,
} from './app/local-benchmark.js';
import { runDurableRestartRegression } from './app/local-regression.js';

async function runDaemon(): Promise<void> {
  const app = await bootstrap();
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
  if (args[0] === '--benchmark' || args[0] === '--soak') {
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
