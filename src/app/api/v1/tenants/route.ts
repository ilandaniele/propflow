import { publicApiRoute } from '@/lib/public-api/handler';
import { NoFilters } from '@/lib/public-api/filters';
import { listTenantsForApi } from '@/lib/public-api/queries';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute('tenants', NoFilters, listTenantsForApi);
