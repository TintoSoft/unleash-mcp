import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnleashClient } from './client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function bodyOf(
  fetchMock: { mock: { calls: unknown[][] } },
  index: number,
): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const featureWithStrategy = {
  name: 'new-checkout-flow',
  project: 'my-project',
  environments: [
    {
      name: 'production',
      environment: 'production',
      enabled: true,
      strategies: [
        {
          id: 'strategy-1',
          name: 'flexibleRollout',
          title: 'Gradual rollout',
          disabled: false,
          parameters: { rollout: '50', groupId: 'new-checkout-flow', stickiness: 'default' },
          constraints: [{ contextName: 'appName', operator: 'IN', values: ['web'] }],
          segments: [3],
        },
      ],
    },
  ],
};

function stubFeatureAndUpdate() {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
    init.method === 'GET'
      ? jsonResponse(featureWithStrategy)
      : jsonResponse({ id: 'strategy-1', name: 'flexibleRollout', parameters: {} }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('UnleashClient updateFeatureStrategy', () => {
  it('puts the merged strategy to the strategy endpoint', async () => {
    const fetchMock = stubFeatureAndUpdate();
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.updateFeatureStrategy(
      'my-project',
      'new-checkout-flow',
      'production',
      'strategy-1',
      {
        constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
      },
    );

    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://unleash.example.com/api/admin/projects/my-project/features/new-checkout-flow/environments/production/strategies/strategy-1',
    );
    expect(init.method).toBe('PUT');
  });

  it('keeps the fields that were not provided', async () => {
    const fetchMock = stubFeatureAndUpdate();
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.updateFeatureStrategy(
      'my-project',
      'new-checkout-flow',
      'production',
      'strategy-1',
      {
        constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
      },
    );

    expect(bodyOf(fetchMock, 1)).toMatchObject({
      name: 'flexibleRollout',
      title: 'Gradual rollout',
      disabled: false,
      parameters: { rollout: '50', groupId: 'new-checkout-flow', stickiness: 'default' },
      constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
      segments: [3],
    });
  });

  it('writes a new rollout percentage into the strategy parameters', async () => {
    const fetchMock = stubFeatureAndUpdate();
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.updateFeatureStrategy(
      'my-project',
      'new-checkout-flow',
      'production',
      'strategy-1',
      {
        rolloutPercentage: 100,
      },
    );

    expect(bodyOf(fetchMock, 1)).toMatchObject({
      parameters: { rollout: '100', groupId: 'new-checkout-flow', stickiness: 'default' },
      constraints: [{ contextName: 'appName', operator: 'IN', values: ['web'] }],
    });
  });

  it('fails with a helpful error when the strategy is not in the environment', async () => {
    stubFeatureAndUpdate();
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await expect(
      client.updateFeatureStrategy('my-project', 'new-checkout-flow', 'production', 'missing-id', {
        rolloutPercentage: 100,
      }),
    ).rejects.toThrow(/missing-id/);
  });

  it('returns the merged strategy without calling the API in dry-run mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', {}, true);

    const strategy = await client.updateFeatureStrategy(
      'my-project',
      'new-checkout-flow',
      'production',
      'strategy-1',
      { constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }] },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(strategy.id).toBe('strategy-1');
    expect(strategy.constraints).toEqual([
      { contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' },
    ]);
  });
});

describe('UnleashClient strategy constraints', () => {
  it('sends constraints in the flexibleRollout strategy payload', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: 'strategy-1', name: 'flexibleRollout', parameters: {} }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.setFlexibleRolloutStrategy('my-project', 'new-checkout-flow', 'production', {
      rolloutPercentage: 100,
      constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
    });

    expect(bodyOf(fetchMock, 0).constraints).toEqual([
      { contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' },
    ]);
  });
});
