import { describe, expect, it, vi } from 'vitest';
import type { ServerContext } from '../context.js';
import type { FeatureStrategy, UnleashClient } from '../unleash/client.js';
import { setFlagRollout } from './setFlagRollout.js';

function makeContext(client: Partial<UnleashClient>): ServerContext {
  return {
    config: {
      unleash: { baseUrl: 'https://unleash.example.com', pat: 'test-pat' },
      server: { dryRun: false, logLevel: 'error', attributionEnabled: true },
    },
    unleashClient: client as UnleashClient,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cache: { projects: null, featureFlags: new Map() },
    notifyProgress: vi.fn(async () => {}),
  };
}

const strategy: FeatureStrategy = {
  id: 'strategy-1',
  name: 'flexibleRollout',
  parameters: { rollout: '100', groupId: 'new-checkout-flow', stickiness: 'default' },
};

describe('set_flag_rollout constraints', () => {
  it('forwards constraints to the strategy configuration', async () => {
    const setFlexibleRolloutStrategy = vi.fn(async () => strategy);
    const context = makeContext({ setFlexibleRolloutStrategy });

    const result = await setFlagRollout(context, {
      projectId: 'my-project',
      featureName: 'new-checkout-flow',
      environment: 'production',
      rolloutPercentage: 100,
      constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
    });

    expect(result.isError).toBeUndefined();
    expect(setFlexibleRolloutStrategy).toHaveBeenCalledWith(
      'my-project',
      'new-checkout-flow',
      'production',
      expect.objectContaining({
        constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
      }),
    );
  });

  it('rejects an unknown constraint operator', async () => {
    const setFlexibleRolloutStrategy = vi.fn(async () => strategy);
    const context = makeContext({ setFlexibleRolloutStrategy });

    const result = await setFlagRollout(context, {
      projectId: 'my-project',
      featureName: 'new-checkout-flow',
      environment: 'production',
      rolloutPercentage: 100,
      constraints: [{ contextName: 'webVersion', operator: 'GREATER_THAN', value: '1.42.0' }],
    });

    expect(result.isError).toBe(true);
    expect(setFlexibleRolloutStrategy).not.toHaveBeenCalled();
  });
});
