import { describe, expect, it, vi } from 'vitest';
import type { ServerContext } from '../context.js';
import type { UnleashClient } from '../unleash/client.js';
import { completeFlag } from './completeFlag.js';

function makeContext(client: Partial<UnleashClient>): ServerContext {
  return {
    config: {
      unleash: {
        baseUrl: 'https://unleash.example.com',
        pat: 'test-pat',
        feedbackUrl: 'https://feedback.example.com',
      },
      server: { dryRun: false, logLevel: 'error', attributionEnabled: true },
    },
    unleashClient: client as UnleashClient,
    feedbackClient: {} as ServerContext['feedbackClient'],
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cache: { projects: null, featureFlags: new Map() },
    getClientInfo: () => undefined,
    notifyProgress: vi.fn(async () => {}),
  };
}

describe('complete_flag', () => {
  it('marks the flag as completed, keeping the feature by default', async () => {
    const completeFeature = vi.fn(async () => {});
    const context = makeContext({ completeFeature });

    const result = await completeFlag(context, {
      projectId: 'my-project',
      featureName: 'new-checkout-flow',
    });

    expect(result.isError).toBeUndefined();
    expect(completeFeature).toHaveBeenCalledWith('my-project', 'new-checkout-flow', {
      status: 'kept',
    });
  });

  it('records a discarded feature and the value that was kept', async () => {
    const completeFeature = vi.fn(async () => {});
    const context = makeContext({ completeFeature });

    await completeFlag(context, {
      projectId: 'my-project',
      featureName: 'checkout-experiment',
      status: 'discarded',
      statusValue: 'control',
    });

    expect(completeFeature).toHaveBeenCalledWith('my-project', 'checkout-experiment', {
      status: 'discarded',
      statusValue: 'control',
    });
  });

  it('tells that the flag stays enabled for the clients that still read it', async () => {
    const completeFeature = vi.fn(async () => {});
    const context = makeContext({ completeFeature });

    const result = await completeFlag(context, {
      projectId: 'my-project',
      featureName: 'new-checkout-flow',
    });

    const text = (result.content as Array<{ type: string; text?: string }>)[0].text ?? '';
    expect(text).toContain('completed (kept)');
    expect(text).toContain('not archived');
    expect(result.structuredContent).toEqual(
      expect.objectContaining({ featureName: 'new-checkout-flow', status: 'kept' }),
    );
  });

  it('rejects a status other than kept or discarded', async () => {
    const completeFeature = vi.fn(async () => {});
    const context = makeContext({ completeFeature });

    const result = await completeFlag(context, {
      projectId: 'my-project',
      featureName: 'new-checkout-flow',
      status: 'archived',
    });

    expect(result.isError).toBe(true);
    expect(completeFeature).not.toHaveBeenCalled();
  });
});
