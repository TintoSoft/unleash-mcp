import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { handleToolError, type ServerContext } from '../context.js';
import type { FeatureEvent } from '../unleash/client.js';
import { createFlagResourceLink } from '../utils/streaming.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const getFlagEventsSchema = z.object({
  featureName: z.string().min(1).describe('Feature flag name'),
  projectId: z
    .string()
    .optional()
    .describe(
      'Project ID, used to scope the search and to build the UI link (optional; a flag name is already unique)',
    ),
  environment: z.string().optional().describe('Only events for this environment'),
  type: z
    .string()
    .optional()
    .describe(
      'Only events of this exact Unleash event type, e.g. "feature-environment-enabled", "feature-strategy-update" or "feature-tag-added"',
    ),
  from: z
    .string()
    .regex(ISO_DATE, 'Use yyyy-MM-dd')
    .optional()
    .describe('Only events from this date onwards (yyyy-MM-dd)'),
  to: z
    .string()
    .regex(ISO_DATE, 'Use yyyy-MM-dd')
    .optional()
    .describe('Only events up to this date (yyyy-MM-dd)'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of events to skip, to page through a long log (default: 0)'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(`Maximum number of events to return, newest first (default: ${DEFAULT_LIMIT})`),
});

type GetFlagEventsInput = z.infer<typeof getFlagEventsSchema>;

/**
 * Unleash renders the narration itself: `summary` is markdown naming who did
 * what and where, and `label` is the short event name. Only fall back to the
 * raw type when the instance sends neither, so this stays a thin pass-through.
 */
export function describeEvent(event: FeatureEvent): string {
  if (event.summary) {
    return event.summary.replace(/\s+/g, ' ').trim();
  }

  const label = event.label ?? event.type ?? 'unknown change';
  const author = event.createdBy ? `${event.createdBy} · ` : '';
  const where = event.environment ? ` in ${event.environment}` : '';

  return `${author}${label}${where}`;
}

/** `2026-09-21 15:47 UTC`, stable regardless of where the server runs. */
function formatTimestamp(createdAt: string | undefined): string {
  if (!createdAt) return 'unknown date';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export async function getFlagEvents(
  context: ServerContext,
  args: unknown,
  progressToken?: string | number,
): Promise<CallToolResult> {
  try {
    const input: GetFlagEventsInput = getFlagEventsSchema.parse(args);
    const limit = input.limit ?? DEFAULT_LIMIT;

    await context.notifyProgress(
      progressToken,
      0,
      100,
      `Searching the event log of "${input.featureName}"...`,
    );

    const projectId = input.projectId ?? context.config.unleash.defaultProject;

    const response = await context.unleashClient.searchEvents({
      feature: input.featureName,
      project: projectId,
      environment: input.environment,
      type: input.type,
      from: input.from,
      to: input.to,
      offset: input.offset,
      limit,
    });

    const events = response.events ?? [];
    const total = response.total ?? events.length;

    await context.notifyProgress(
      progressToken,
      100,
      100,
      `Found ${events.length} event${events.length === 1 ? '' : 's'} for "${input.featureName}"`,
    );

    const filterSummary = [
      input.environment ? `environment "${input.environment}"` : null,
      input.type ? `type "${input.type}"` : null,
      input.from ? `from ${input.from}` : null,
      input.to ? `to ${input.to}` : null,
    ].filter((part): part is string => part !== null);

    const lines = events.map(
      (event) => `- ${formatTimestamp(event.createdAt)} · ${describeEvent(event)}`,
    );

    const apiUrl = `${context.config.unleash.baseUrl}/api/admin/search/events`;
    const flagLink = projectId
      ? createFlagResourceLink(context.config.unleash.baseUrl, projectId, input.featureName)
      : undefined;

    const header = `Event log for "${input.featureName}" — showing ${events.length} of ${total} matching event${total === 1 ? '' : 's'}${
      filterSummary.length > 0 ? ` (filtered by ${filterSummary.join(', ')})` : ''
    }, newest first.`;

    const body =
      lines.length > 0
        ? lines.join('\n')
        : '- No events matched. Unleash keeps events for a limited retention window, so an old change may no longer be listed.';

    const messageLines = [header, body];
    if (flagLink) {
      messageLines.push(`View feature: ${flagLink.url}`);
    }
    messageLines.push(`Admin API: ${apiUrl}`);

    context.logger.info(
      `Retrieved ${events.length} event(s) for "${input.featureName}"${
        filterSummary.length > 0 ? ` (${filterSummary.join(', ')})` : ''
      }`,
    );

    const structuredContent = {
      success: true,
      featureName: input.featureName,
      total,
      returnedEvents: events.length,
      filters: {
        projectId,
        environment: input.environment,
        type: input.type,
        from: input.from,
        to: input.to,
        offset: input.offset,
        limit,
      },
      events,
      links: {
        api: apiUrl,
        ...(flagLink ? { ui: flagLink.url, resourceUri: flagLink.resource.uri } : {}),
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: messageLines.join('\n'),
        },
      ],
      structuredContent,
    };
  } catch (error) {
    return handleToolError(context, error, 'get_flag_events');
  }
}

export const getFlagEventsTool = {
  name: 'get_flag_events',
  title: 'Get flag events',
  annotations: { readOnlyHint: true },
  description:
    "Search a feature flag's event log through the Unleash Admin API: who changed it, when, in which environment and what changed, newest first. Use this to answer when a flag was enabled or disabled, who did it, and how its rollout evolved, instead of inferring it from the current state. Unleash applies the environment, type and date filters and the pagination server side.",
  inputSchema: getFlagEventsSchema,
  implementation: getFlagEvents,
};
