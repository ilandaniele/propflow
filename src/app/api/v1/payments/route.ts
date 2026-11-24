import { publicApiRoute } from '@/lib/public-api/handler';
import { PaymentFilters } from '@/lib/public-api/filters';
import { listPaymentsForApi } from '@/lib/public-api/queries';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute('payments', PaymentFilters, listPaymentsForApi);
