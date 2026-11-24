import { publicApiRoute } from '@/lib/public-api/handler';
import { UnitFilters } from '@/lib/public-api/filters';
import { listUnitsForApi } from '@/lib/public-api/queries';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute('units', UnitFilters, listUnitsForApi);
