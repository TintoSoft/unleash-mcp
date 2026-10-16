import { isIP } from 'node:net';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  askForProjectId,
  handleToolError,
  resolveProjectId,
  type ServerContext,
} from '../context.js';
import { createFlagResourceLink } from '../utils/streaming.js';
import { constraintSchema } from './strategySchemas.js';

function isIpOrCidr(entry: string): boolean {
  const [address, prefix, ...rest] = entry.split('/');
  const version = isIP(address ?? '');
  if (version === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;

  const maxPrefix = version === 4 ? 32 : 128;
  return /^\d+$/.test(prefix) && Number(prefix) <= maxPrefix;
}

const setFlagRemoteAddressSchema = z.object({
  projectId: z
    .string()
    .optional()
    .describe(
      'Project ID where the feature flag resides (optional if UNLEASH_DEFAULT_PROJECT is set)',
    ),
  featureName: z.string().min(1).describe('Feature flag name'),
  environment: z.string().min(1).describe('Target environment'),
  ips: z
    .array(
      z.string().trim().refine(isIpOrCidr, { message: 'Must be an IP address or a CIDR range' }),
    )
    .min(1)
    .describe('IP addresses or CIDR ranges to enable the flag for, e.g. ["10.0.0.0/22"]'),
  title: z.string().optional().describe('Optional descriptive title for the strategy'),
  disabled: z.boolean().optional().describe('Disable the strategy (defaults to false)'),
  constraints: z
    .array(constraintSchema)
    .optional()
    .describe(
      'Optional constraints that gate the strategy, e.g. webVersion NUM_GTE so only clients that ship the code are matched.',
    ),
});

type SetFlagRemoteAddressInput = z.infer<typeof setFlagRemoteAddressSchema>;

export async function setFlagRemoteAddress(
  context: ServerContext,
  args: unknown,
  progressToken?: string | number,
): Promise<CallToolResult> {
  try {
    const input: SetFlagRemoteAddressInput = setFlagRemoteAddressSchema.parse(args);

    const projectId = await resolveProjectId(input.projectId, context);
    if (!projectId) return askForProjectId(context);

    const ipsDisplay = input.ips.join(', ');
    const mode = context.config.server.dryRun ? '[DRY RUN] ' : '';

    await context.notifyProgress(
      progressToken,
      0,
      100,
      `${mode}Configuring remoteAddress strategy for "${input.featureName}" (${ipsDisplay})...`,
    );

    const strategy = await context.unleashClient.setRemoteAddressStrategy(
      projectId,
      input.featureName,
      input.environment,
      {
        ips: input.ips,
        title: input.title,
        disabled: input.disabled,
        constraints: input.constraints,
      },
    );

    await context.notifyProgress(
      progressToken,
      100,
      100,
      `${mode}Strategy configured for "${input.featureName}" in "${input.environment}"`,
    );

    const { url, resource } = createFlagResourceLink(
      context.config.unleash.baseUrl,
      projectId,
      input.featureName,
    );

    const apiUrl = `${context.config.unleash.baseUrl}/api/admin/projects/${encodeURIComponent(
      projectId,
    )}/features/${encodeURIComponent(input.featureName)}/environments/${encodeURIComponent(
      input.environment,
    )}/strategies`;

    const message = context.config.server.dryRun
      ? `[DRY RUN] Would configure remoteAddress strategy for "${input.featureName}" in "${input.environment}" for ${ipsDisplay}.`
      : `Configured remoteAddress strategy for "${input.featureName}" in "${input.environment}" for ${ipsDisplay}.`;

    context.logger.info(`${message}${input.disabled ? ' Strategy is marked as disabled.' : ''}`);

    return {
      content: [
        {
          type: 'text',
          text: `${message}\nView feature: ${url}\nAdmin API: ${apiUrl}`,
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
        environment: input.environment,
        ips: input.ips,
        strategy,
        links: {
          ui: url,
          api: apiUrl,
          resourceUri: resource.uri,
        },
      },
    };
  } catch (error) {
    return handleToolError(context, error, 'set_flag_remote_address');
  }
}

export const setFlagRemoteAddressTool = {
  name: 'set_flag_remote_address',
  title: 'Set flag remote address strategy',
  annotations: { readOnlyHint: false, destructiveHint: false },
  description: `Add a native remoteAddress (IPs) strategy to a feature flag environment, so the flag is on only for requests from the given IP addresses or CIDR ranges (e.g. an office network). This does NOT enable the feature; call toggle_flag_environment to turn environments on or off.

Each entry is matched as an exact IP or as a CIDR range: \`10.0.0.0/22\` covers 10.0.0.0 to 10.0.3.255. Constraints such as \`webVersion NUM_GTE 1.42.0\` can be combined with it.

Note: this creates a new strategy. Strategies in the same environment are OR-ed, so remove any broader strategy with remove_flag_strategy if only these IPs should match.`,
  inputSchema: setFlagRemoteAddressSchema,
  implementation: setFlagRemoteAddress,
};
