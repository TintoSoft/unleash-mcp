import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  askForProjectId,
  handleToolError,
  resolveProjectId,
  type ServerContext,
} from '../context.js';
import { createFlagResourceLink } from '../utils/streaming.js';

const completeFlagSchema = z.object({
  projectId: z
    .string()
    .optional()
    .describe(
      'Project ID where the feature flag resides (optional if UNLEASH_DEFAULT_PROJECT is set)',
    ),
  featureName: z.string().min(1).describe('Feature flag name'),
  status: z
    .enum(['kept', 'discarded'])
    .default('kept')
    .describe(
      'Outcome of the feature: "kept" when the code kept the flagged path (default), "discarded" when it was removed',
    ),
  statusValue: z
    .string()
    .min(1)
    .optional()
    .describe('Optional value that was kept, e.g. the winning variant of an experiment'),
});

type CompleteFlagInput = z.infer<typeof completeFlagSchema>;

export async function completeFlag(
  context: ServerContext,
  args: unknown,
  progressToken?: string | number,
): Promise<CallToolResult> {
  try {
    const input: CompleteFlagInput = completeFlagSchema.parse(args);

    const projectId = await resolveProjectId(input.projectId, context);
    if (!projectId) return askForProjectId(context);

    const mode = context.config.server.dryRun ? '[DRY RUN] ' : '';

    await context.notifyProgress(
      progressToken,
      0,
      100,
      `${mode}Marking "${input.featureName}" as completed...`,
    );

    await context.unleashClient.completeFeature(projectId, input.featureName, {
      status: input.status,
      ...(input.statusValue && { statusValue: input.statusValue }),
    });

    await context.notifyProgress(progressToken, 100, 100, `${mode}Flag marked as completed`);

    const { url, resource } = createFlagResourceLink(
      context.config.unleash.baseUrl,
      projectId,
      input.featureName,
    );

    const apiUrl = `${context.config.unleash.baseUrl}/api/admin/projects/${encodeURIComponent(
      projectId,
    )}/features/${encodeURIComponent(input.featureName)}/lifecycle/complete`;

    const message = `${mode}Marked "${input.featureName}" as completed (${input.status}).`;
    const note =
      'The flag is not archived and its environments and strategies are unchanged, so clients that still read it keep the same value.';

    context.logger.info(message);

    return {
      content: [
        {
          type: 'text',
          text: `${message}\n${note}\nView feature: ${url}\nAdmin API: ${apiUrl}`,
        },
        {
          type: 'resource_link',
          name: input.featureName,
          uri: resource.uri,
          mimeType: resource.mimeType,
          title: resource.text,
        },
      ],
      structuredContent: {
        success: true,
        dryRun: context.config.server.dryRun,
        projectId,
        featureName: input.featureName,
        status: input.status,
        ...(input.statusValue && { statusValue: input.statusValue }),
        links: {
          ui: url,
          api: apiUrl,
          resourceUri: resource.uri,
        },
      },
    };
  } catch (error) {
    return handleToolError(context, error, 'complete_flag');
  }
}

export const completeFlagTool = {
  name: 'complete_flag',
  title: 'Complete flag lifecycle',
  annotations: { readOnlyHint: false, destructiveHint: false },
  description: `Mark a feature flag as completed in its lifecycle, recording whether the feature was kept or discarded.

Use this once the code that read the flag has been removed and released. Unlike archiving, the flag stays live: its environments, strategies and value do not change, so older client versions that still evaluate it keep working.

Use status "kept" when the code kept the flagged path (the usual case after a rollout to 100 %), and "discarded" when the feature was removed. Use get_flag_state to check the flag before completing it.`,
  inputSchema: completeFlagSchema,
  implementation: completeFlag,
};
