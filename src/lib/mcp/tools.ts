import { z } from 'zod';
import { ApiPageSchema, toPage, type ApiPage } from '@/lib/public-api/pagination';
import { NoFilters, PaymentFilters, UnitFilters } from '@/lib/public-api/filters';
import { listPaymentsForApi, listPropertiesForApi, listTenantsForApi, listUnitsForApi } from '@/lib/public-api/queries';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface McpTool {
  definition: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: { readOnlyHint: true; openWorldHint: false };
  };
  run: (orgId: string, args: unknown) => Promise<ToolResult>;
}

const textResult = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  ...(isError ? { isError } : {}),
});

const describeIssues = (error: z.ZodError) =>
  `Invalid arguments: ${error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`;

function listTool<S extends z.ZodObject, T>(
  name: string,
  description: string,
  filterSchema: S,
  fetchRows: (orgId: string, page: ApiPage, filters: z.infer<S>) => Promise<T[]>,
): McpTool {
  const argsSchema = ApiPageSchema.extend(filterSchema.shape);
  return {
    definition: {
      name,
      description,
      inputSchema: z.toJSONSchema(argsSchema, { io: 'input' }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async run(orgId, args) {
      const parsed = argsSchema.safeParse(args ?? {});
      if (!parsed.success) return textResult(describeIssues(parsed.error), true);
      const page = ApiPageSchema.parse(parsed.data);
      const rows = await fetchRows(orgId, page, filterSchema.parse(parsed.data));
      return textResult(toPage(rows, page));
    },
  };
}

const PAGINATION_HINT = 'Paginate with limit (1-100, default 50) and offset; check pagination.hasMore.';

const TOOLS = [
  listTool('list_properties', `List the organization's properties (buildings). ${PAGINATION_HINT}`, NoFilters, listPropertiesForApi),
  listTool('list_units', `List rentable units, optionally for one propertyId. ${PAGINATION_HINT}`, UnitFilters, listUnitsForApi),
  listTool('list_tenants', `List tenants with contact details and their unit. ${PAGINATION_HINT}`, NoFilters, listTenantsForApi),
  listTool(
    'list_payments',
    `List payments received in a month (YYYY-MM), optionally by status. ${PAGINATION_HINT}`,
    PaymentFilters.required({ month: true }),
    listPaymentsForApi,
  ),
];

export const toolDefinitions = () => TOOLS.map((tool) => tool.definition);

export const findTool = (name: string) => TOOLS.find((tool) => tool.definition.name === name);
