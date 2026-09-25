import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPublicOrg, listPublicListings, type PublicListingCard } from '@/lib/public/catalog';

const PAGE_SIZE = 24;

interface PageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ operation?: string; page?: string }>;
}

function isOperation(value: string | undefined): value is 'rent' | 'sale' {
  return value === 'rent' || value === 'sale';
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const org = await getPublicOrg(orgSlug);
  if (!org) return {};

  const title = `${org.name} — Propiedades disponibles`;
  const description = `Catálogo de propiedades en alquiler y venta de ${org.name}.`;

  return {
    title,
    description,
    alternates: { canonical: `/p/${org.slug}` },
    openGraph: { title, description, type: 'website' },
    robots: { index: true, follow: true },
  };
}

export default async function PublicCatalogPage({ params, searchParams }: PageProps) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const org = await getPublicOrg(orgSlug);
  if (!org) notFound();

  const t = await getTranslations('publicCatalog');
  const operation = isOperation(sp.operation) ? sp.operation : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const { items, total } = await listPublicListings(org.id, { operation, page });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const orgSlugPath = org.slug;

  function filterHref(op: 'rent' | 'sale' | undefined): string {
    const qs = op ? `?operation=${op}` : '';
    return `/p/${orgSlugPath}${qs}`;
  }

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (operation) params.set('operation', operation);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return `/p/${orgSlugPath}${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-slate-900">{org.name}</h1>
          <p className="text-sm text-slate-500">{t('pageTitle')}</p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <nav className="flex gap-2" aria-label="Filtros">
          {([undefined, 'rent', 'sale'] as const).map((op) => (
            <Link
              key={op ?? 'all'}
              href={filterHref(op)}
              className={[
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                operation === op
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
              ].join(' ')}
            >
              {op === 'rent' ? t('filterRent') : op === 'sale' ? t('filterSale') : t('filterAll')}
            </Link>
          ))}
        </nav>

        {items.length === 0 ? (
          <p className="text-sm text-slate-400 py-12 text-center">{t('emptyState')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <ListingCard key={item.slug} orgSlug={org.slug} item={item} t={t} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-4 pt-4" aria-label="Paginación">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="text-sm text-brand-600 hover:underline">
                {t('paginationPrev')}
              </Link>
            )}
            <span className="text-sm text-slate-400">{page} / {totalPages}</span>
            {page < totalPages && (
              <Link href={pageHref(page + 1)} className="text-sm text-brand-600 hover:underline">
                {t('paginationNext')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}

function ListingCard({
  orgSlug,
  item,
  t,
}: {
  orgSlug: string;
  item: PublicListingCard;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <Link
      href={`/p/${orgSlug}/${item.slug}`}
      className="block bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="aspect-[4/3] bg-slate-100">
        {item.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- signed-URL redirect target changes per request; next/image can't cache it usefully
          <img src={item.coverImageUrl} alt={item.title ?? ''} className="w-full h-full object-cover" loading="lazy" />
        )}
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-medium text-slate-900 truncate">{item.title ?? t('pageTitle')}</p>
        <p className="text-sm text-slate-500">
          {item.price ? `${item.currency} ${Number(item.price).toLocaleString('es-PE')}` : t('priceOnRequest')}
        </p>
        <p className="text-xs text-slate-400">
          {item.zone ?? t('availabilityToConfirm')}
          {item.bedrooms != null ? ` · ${item.bedrooms} ${t('detail.bedroomsLabel')}` : ''}
        </p>
      </div>
    </Link>
  );
}
