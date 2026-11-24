import { z } from 'zod';
import { publicApiRoute } from '@/lib/public-api/handler';
import { listPropertiesForApi } from '@/lib/public-api/queries';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute('properties', z.object({}), listPropertiesForApi);
