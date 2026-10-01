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

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn(async () => jsonResponse({ events: [], total: 0 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestedUrl(fetchMock: ReturnType<typeof stubFetch>): URL {
  const [url] = fetchMock.mock.calls[0] as unknown as [string];
  return new URL(url);
}

describe('UnleashClient.searchEvents', () => {
  it('searches the event log through the Unleash search endpoint', async () => {
    const fetchMock = stubFetch();
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.searchEvents({ feature: 'new-checkout-flow' });

    const url = requestedUrl(fetchMock);
    expect(url.pathname).toBe('/api/admin/search/events');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('GET');
  });

  // Unleash validates these against `^(IS):<value>$` and answers 400 without it.
  it('prefixes every filter with the IS operator Unleash expects', async () => {
    const fetchMock = stubFetch();
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.searchEvents({
      feature: 'new-checkout-flow',
      project: 'my-project',
      environment: 'staging',
      type: 'feature-environment-enabled',
      from: '2026-09-01',
      to: '2026-09-30',
    });

    const params = requestedUrl(fetchMock).searchParams;
    expect(params.get('feature')).toBe('IS:new-checkout-flow');
    expect(params.get('project')).toBe('IS:my-project');
    expect(params.get('environment')).toBe('IS:staging');
    expect(params.get('type')).toBe('IS:feature-environment-enabled');
    expect(params.get('from')).toBe('IS:2026-09-01');
    expect(params.get('to')).toBe('IS:2026-09-30');
  });

  it('sends pagination as plain numbers, without the operator', async () => {
    const fetchMock = stubFetch();
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.searchEvents({ feature: 'new-checkout-flow', offset: 20, limit: 5 });

    const params = requestedUrl(fetchMock).searchParams;
    expect(params.get('offset')).toBe('20');
    expect(params.get('limit')).toBe('5');
  });

  it('leaves out the filters the caller did not set', async () => {
    const fetchMock = stubFetch();
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.searchEvents({ feature: 'new-checkout-flow' });

    const params = requestedUrl(fetchMock).searchParams;
    expect(params.has('environment')).toBe(false);
    expect(params.has('type')).toBe(false);
    expect(params.has('from')).toBe(false);
    expect([...params.keys()]).toEqual(['feature']);
  });

  it('returns the events and the total Unleash counted', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        total: 13,
        events: [{ id: 1, type: 'feature-environment-enabled', label: 'Flag enabled' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    const result = await client.searchEvents({ feature: 'new-checkout-flow' });

    expect(result.total).toBe(13);
    expect(result.events).toHaveLength(1);
  });

  it('does not reach the network in dry-run mode', async () => {
    const fetchMock = stubFetch();
    const client = new UnleashClient(
      'https://unleash.example.com',
      { Authorization: 'test-pat' },
      true,
    );

    const result = await client.searchEvents({ feature: 'new-checkout-flow' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.events[0].featureName).toBe('new-checkout-flow');
  });
});
