import { describe, expect, it, vi } from 'vitest';
import type { ServerContext } from '../context.js';
import type { FeatureStrategy, UnleashClient } from '../unleash/client.js';
import { setFlagRemoteAddress } from './setFlagRemoteAddress.js';

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

const strategy: FeatureStrategy = {
  id: 'strategy-1',
  name: 'remoteAddress',
  parameters: { IPs: '10.0.0.0/22' },
};

describe('set_flag_remote_address', () => {
  it('creates a remoteAddress strategy with the IPs, title and constraints', async () => {
    const setRemoteAddressStrategy = vi.fn(async () => strategy);
    const context = makeContext({ setRemoteAddressStrategy });

    const result = await setFlagRemoteAddress(context, {
      projectId: 'my-project',
      featureName: 'new-checkout-flow',
      environment: 'production',
      ips: ['10.0.0.0/22', '192.168.1.10'],
      title: 'Office network',
      constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
    });

    expect(result.isError).toBeUndefined();
    expect(setRemoteAddressStrategy).toHaveBeenCalledWith(
      'my-project',
      'new-checkout-flow',
      'production',
      {
        ips: ['10.0.0.0/22', '192.168.1.10'],
        title: 'Office network',
        disabled: undefined,
        constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
      },
    );
  });

  it('rejects an empty IP list', async () => {
    const setRemoteAddressStrategy = vi.fn(async () => strategy);
    const context = makeContext({ setRemoteAddressStrategy });

    const result = await setFlagRemoteAddress(context, {
      projectId: 'my-project',
      featureName: 'new-checkout-flow',
      environment: 'production',
      ips: [],
    });

    expect(result.isError).toBe(true);
    expect(setRemoteAddressStrategy).not.toHaveBeenCalled();
  });

  it('rejects an entry that is not an IP address or CIDR range', async () => {
    const setRemoteAddressStrategy = vi.fn(async () => strategy);
    const context = makeContext({ setRemoteAddressStrategy });

    const result = await setFlagRemoteAddress(context, {
      projectId: 'my-project',
      featureName: 'new-checkout-flow',
      environment: 'production',
      ips: ['office'],
    });

    expect(result.isError).toBe(true);
    expect(setRemoteAddressStrategy).not.toHaveBeenCalled();
  });
});
