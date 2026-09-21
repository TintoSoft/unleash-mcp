import { describe, expect, it, vi } from 'vitest';
import type { ServerContext } from '../context.js';
import type { FeatureEvent, SearchEventsOptions, UnleashClient } from '../unleash/client.js';
import { describeEvent, getFlagEvents } from './getFlagEvents.js';

function makeContext(events: FeatureEvent[], total = events.length) {
  const searchEvents = vi.fn(async (_options: SearchEventsOptions) => ({ events, total }));
  const context = {
    config: {
      unleash: { baseUrl: 'https://unleash.example.com', pat: 'test-pat' },
      server: { dryRun: false, logLevel: 'error', attributionEnabled: true },
    },
    unleashClient: { searchEvents } as unknown as UnleashClient,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cache: { projects: null, featureFlags: new Map() },
    notifyProgress: vi.fn(async () => {}),
  } as ServerContext;

  return { context, searchEvents };
}

function event(overrides: Partial<FeatureEvent> = {}): FeatureEvent {
  return {
    id: 1,
    type: 'feature-environment-enabled',
    label: 'Flag enabled',
    createdBy: 'maintainer@example.com',
    createdAt: '2026-09-21T15:47:02.000Z',
    environment: 'staging',
    featureName: 'new-checkout-flow',
    ...overrides,
  };
}

async function run(context: ServerContext, args: Record<string, unknown> = {}) {
  const result = await getFlagEvents(context, { featureName: 'new-checkout-flow', ...args });
  return {
    text: (result.content as Array<{ type: string; text?: string }>)[0].text ?? '',
    structured: result.structuredContent as {
      total?: number;
      returnedEvents?: number;
      events?: FeatureEvent[];
      links?: Record<string, string>;
    },
    isError: result.isError,
  };
}

describe('get_flag_events', () => {
  it('answers who enabled the flag and when', async () => {
    const { context } = makeContext([event()]);

    const { text, structured } = await run(context);

    expect(text).toContain('2026-09-21 15:47 UTC');
    expect(text).toContain('maintainer@example.com');
    expect(text).toContain('Flag enabled');
    expect(structured.returnedEvents).toBe(1);
  });

  it('hands every filter to Unleash instead of filtering in memory', async () => {
    const { context, searchEvents } = makeContext([event()]);

    await run(context, {
      projectId: 'my-project',
      environment: 'staging',
      type: 'feature-environment-enabled',
      from: '2026-09-01',
      to: '2026-09-30',
      offset: 10,
      limit: 5,
    });

    expect(searchEvents).toHaveBeenCalledWith({
      feature: 'new-checkout-flow',
      project: 'my-project',
      environment: 'staging',
      type: 'feature-environment-enabled',
      from: '2026-09-01',
      to: '2026-09-30',
      offset: 10,
      limit: 5,
    });
  });

  it('applies the default limit when the caller does not set one', async () => {
    const { context, searchEvents } = makeContext([event()]);

    await run(context);

    expect(searchEvents.mock.calls[0][0]).toMatchObject({ limit: 20 });
  });

  it('rejects a date that is not yyyy-MM-dd, as the Unleash API would', async () => {
    const { context, searchEvents } = makeContext([event()]);

    const { isError } = await run(context, { from: '21-09-2026' });

    expect(isError).toBe(true);
    expect(searchEvents).not.toHaveBeenCalled();
  });

  it('reports the total Unleash counted, not the page size', async () => {
    const { context } = makeContext([event(), event({ id: 2 })], 13);

    const { text, structured } = await run(context, { limit: 2 });

    expect(text).toContain('showing 2 of 13 matching events');
    expect(structured.total).toBe(13);
  });

  it('explains an empty result instead of returning a bare list', async () => {
    const { context } = makeContext([]);

    const { text } = await run(context);

    expect(text).toContain('No events matched');
    expect(text).toContain('retention window');
  });

  it('links to the flag in the UI only when a project is known', async () => {
    const withoutProject = await run(makeContext([event()]).context);
    expect(withoutProject.text).not.toContain('View feature:');
    expect(withoutProject.structured.links?.ui).toBeUndefined();

    const withProject = await run(makeContext([event()]).context, { projectId: 'my-project' });
    expect(withProject.text).toContain(
      'View feature: https://unleash.example.com/projects/my-project/features/new-checkout-flow',
    );
  });

  it('reports the error instead of throwing when the API fails', async () => {
    const { context } = makeContext([]);
    context.unleashClient.searchEvents = vi.fn(async () => {
      throw new Error('boom');
    });

    const { isError, text } = await run(context);

    expect(isError).toBe(true);
    expect(text).toContain('boom');
  });
});

describe('describeEvent', () => {
  it('uses the narration Unleash already renders', () => {
    const description = describeEvent({
      type: 'feature-environment-enabled',
      label: 'Flag enabled',
      summary:
        '**maintainer@example.com** enabled **[new-checkout-flow](https://unleash.example.com/x)**\n for the **staging** environment',
    });

    expect(description).toBe(
      '**maintainer@example.com** enabled **[new-checkout-flow](https://unleash.example.com/x)** for the **staging** environment',
    );
  });

  it('falls back to the label when the instance sends no summary', () => {
    expect(
      describeEvent({
        type: 'feature-environment-enabled',
        label: 'Flag enabled',
        createdBy: 'maintainer@example.com',
        environment: 'staging',
      }),
    ).toBe('maintainer@example.com · Flag enabled in staging');
  });

  it('falls back to the raw event type when there is neither summary nor label', () => {
    expect(
      describeEvent({ type: 'feature-strategy-update', createdBy: 'maintainer@example.com' }),
    ).toBe('maintainer@example.com · feature-strategy-update');
  });
});
