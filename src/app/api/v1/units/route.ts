import { z } from 'zod';
import { publicApiRoute } from '@/lib/public-api/handler';
import { listUnitsForApi } from '@/lib/public-api/queries';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute('units', z.object({ propertyId: z.string().uuid().optional() }), listUnitsForApi);
