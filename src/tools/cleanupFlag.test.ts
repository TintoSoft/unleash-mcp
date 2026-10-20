import { describe, expect, it, vi } from 'vitest';
import type { ServerContext } from '../context.js';
import { cleanupFlag } from './cleanupFlag.js';

function makeContext(): ServerContext {
  return {
    config: {
      unleash: {
        baseUrl: 'https://unleash.example.com',
        pat: 'test-pat',
        feedbackUrl: 'https://feedback.example.com',
      },
      server: { dryRun: false, logLevel: 'error', attributionEnabled: true },
    },
    unleashClient: {} as ServerContext['unleashClient'],
    feedbackClient: {} as ServerContext['feedbackClient'],
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cache: { projects: null, featureFlags: new Map() },
    getClientInfo: () => undefined,
    notifyProgress: vi.fn(async () => {}),
  };
}

const guidanceOf = (result: Awaited<ReturnType<typeof cleanupFlag>>) =>
  (result.content as Array<{ type: string; text?: string }>)[0].text ?? '';

describe('cleanup_flag', () => {
  it('ends by completing the flag as kept once the cleanup that keeps the enabled path is released', async () => {
    const result = await cleanupFlag(makeContext(), {
      flagName: 'new-checkout-flow',
      preservePath: 'enabled',
    });

    const guidance = guidanceOf(result);
    expect(guidance).toContain('complete_flag');
    expect(guidance).toContain('"status": "kept"');
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        nextStep: {
          tool: 'complete_flag',
          when: 'after_release',
          arguments: { featureName: 'new-checkout-flow', status: 'kept' },
        },
      }),
    );
  });

  it('completes the flag as discarded when the cleanup keeps the disabled path', async () => {
    const result = await cleanupFlag(makeContext(), {
      flagName: 'old-banner',
      preservePath: 'disabled',
    });

    expect(guidanceOf(result)).toContain('"status": "discarded"');
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        nextStep: expect.objectContaining({
          arguments: { featureName: 'old-banner', status: 'discarded' },
        }),
      }),
    );
  });

  it('warns not to archive the flag because older clients may still read it', async () => {
    const result = await cleanupFlag(makeContext(), {
      flagName: 'new-checkout-flow',
      preservePath: 'enabled',
    });

    expect(guidanceOf(result)).toContain('Do not archive');
  });
});
