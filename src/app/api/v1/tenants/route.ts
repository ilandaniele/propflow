import { z } from 'zod';
import { publicApiRoute } from '@/lib/public-api/handler';
import { listTenantsForApi } from '@/lib/public-api/queries';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute('tenants', z.object({}), listTenantsForApi);
