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

describe('UnleashClient feature tags', () => {
  it('posts a tag to the feature tags endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ type: 'owner', value: 'squad-checkout' }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    const tag = await client.addFeatureTag('new checkout/flow', {
      type: 'owner',
      value: 'squad-checkout',
    });

    expect(tag).toEqual({ type: 'owner', value: 'squad-checkout' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://unleash.example.com/api/admin/features/new%20checkout%2Fflow/tags');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ type: 'owner', value: 'squad-checkout' });
  });

  it('maps tags from the project features listing', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        features: [
          {
            name: 'new-checkout-flow',
            project: 'my-project',
            type: 'release',
            tags: [{ type: 'owner', value: 'squad-checkout' }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    const flags = await client.listFeatureFlags('my-project');

    expect(flags[0].tags).toEqual([{ type: 'owner', value: 'squad-checkout' }]);
  });

  it('echoes the requested tags without calling the API in dry-run mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', {}, true);

    const response = await client.createFeatureFlag('my-project', {
      name: 'new-checkout-flow',
      type: 'release',
      description: 'Controls the new checkout flow',
      tags: [{ type: 'owner', value: 'squad-checkout' }],
    });

    expect(response.tags).toEqual([{ type: 'owner', value: 'squad-checkout' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('UnleashClient updateFeatureTags', () => {
  it('puts added and removed tags to the feature tags endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ version: 1, tags: [{ type: 'simple', value: 'squad-checkout' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    const tags = await client.updateFeatureTags('new-checkout-flow', {
      addedTags: [{ type: 'simple', value: 'squad-checkout' }],
      removedTags: [{ type: 'simple', value: 'squad-old' }],
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://unleash.example.com/api/admin/features/new-checkout-flow/tags');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      addedTags: [{ type: 'simple', value: 'squad-checkout' }],
      removedTags: [{ type: 'simple', value: 'squad-old' }],
    });
    expect(tags).toEqual([{ type: 'simple', value: 'squad-checkout' }]);
  });

  it('sends an empty list for the side that was not requested', async () => {
    // The Unleash API requires both addedTags and removedTags to be present.
    const fetchMock = vi.fn(async () => jsonResponse({ version: 1, tags: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', { Authorization: 'test-pat' });

    await client.updateFeatureTags('new-checkout-flow', {
      addedTags: [{ type: 'simple', value: 'squad-checkout' }],
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      addedTags: [{ type: 'simple', value: 'squad-checkout' }],
      removedTags: [],
    });
  });

  it('echoes the added tags without calling the API in dry-run mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new UnleashClient('https://unleash.example.com', {}, true);

    const tags = await client.updateFeatureTags('new-checkout-flow', {
      addedTags: [{ type: 'simple', value: 'squad-checkout' }],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(tags).toEqual([{ type: 'simple', value: 'squad-checkout' }]);
  });
});
