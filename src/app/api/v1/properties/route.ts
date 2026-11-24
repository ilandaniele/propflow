import { publicApiRoute } from '@/lib/public-api/handler';
import { NoFilters } from '@/lib/public-api/filters';
import { listPropertiesForApi } from '@/lib/public-api/queries';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute('properties', NoFilters, listPropertiesForApi);
