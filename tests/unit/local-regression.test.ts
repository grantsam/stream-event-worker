import { describe, expect, it } from 'vitest';
import { runDurableRestartRegression } from '../../src/app/local-regression.js';

describe('durable restart regression', () => {
  it('preserves dedupe through a deterministic restart under load', async () => {
    const summary = await runDurableRestartRegression(6);
    expect(summary).toEqual({
      mode: 'durable_restart_regression',
      generatedEvents: 6,
      processedEvents: 7,
      dispatches: 6,
      duplicateDispatches: 0,
      gaps: 0,
      errors: 0,
      restarts: 1,
      scope: 'local_worker_mock_transport_only',
      messengerE2e: false,
    });
  });
});
