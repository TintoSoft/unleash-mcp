import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnleashClient } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UnleashClient setRemoteAddressStrategy', () => {
  it('posts a remoteAddress strategy with the IPs joined by commas', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ id: 'strategy-1', name: 'remoteAddress', parameters: {} }),
          text: async () => '{}',
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.setRemoteAddressStrategy('my-project', 'new-checkout-flow', 'production', {
      ips: ['10.0.0.0/22', '192.168.1.10'],
      title: 'Office network',
      constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://unleash.example.com/api/admin/projects/my-project/features/new-checkout-flow/environments/production/strategies',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'remoteAddress',
      title: 'Office network',
      parameters: { IPs: '10.0.0.0/22,192.168.1.10' },
      constraints: [{ contextName: 'webVersion', operator: 'NUM_GTE', value: '1.42.0' }],
    });
  });
});
