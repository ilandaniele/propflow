import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { getPublicOrg, getPublicListing } from '@/lib/public/catalog';
import { getWhatsAppDisplayPhone } from '@/lib/widget/channel';
import { buildWhatsAppDeepLink } from '@/lib/widget/handoff-codes';

interface PageProps {
  params: Promise<{ orgSlug: string; listingSlug: string }>;
}

function plainTextExcerpt(text: string | null, maxLength: number): string | undefined {
  if (!text) return undefined;
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, listingSlug } = await params;
  const org = await getPublicOrg(orgSlug);
  if (!org) return {};
  const listing = await getPublicListing(org.id, listingSlug);
  if (!listing) return {};

  const title = `${listing.title ?? 'Propiedad'} — ${org.name}`;
  const description = plainTextExcerpt(listing.description, 160);

  return {
    title,
    description,
    alternates: { canonical: `/p/${org.slug}/${listing.slug}` },
    openGraph: { title, description, type: 'website' },
    robots: { index: true, follow: true },
  };
}

export default async function PublicListingPage({ params }: PageProps) {
  const { orgSlug, listingSlug } = await params;
  const org = await getPublicOrg(orgSlug);
  if (!org) notFound();

  const listing = await getPublicListing(org.id, listingSlug);
  if (!listing) notFound();

  const [t, headersList, whatsappDisplayPhone] = await Promise.all([
    getTranslations('publicCatalog'),
    headers(),
    getWhatsAppDisplayPhone(org.id),
  ]);
  const nonce = headersList.get('x-nonce') ?? undefined;

  const whatsappHref = whatsappDisplayPhone
    ? buildWhatsAppDeepLink(
        whatsappDisplayPhone,
        listing.refCode
          ? `Hola, quiero más información sobre ${listing.title ?? 'esta propiedad'} (ref ${listing.refCode})`
          : `Hola, quiero más información sobre ${listing.title ?? 'esta propiedad'}`,
      )
    : null;

  const widgetRef = listing.refCode ?? listing.slug;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <a href={`/p/${org.slug}`} className="text-sm text-brand-600 hover:underline">
          ← {t('backToCatalogue')}
        </a>

        {listing.imageUrls.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {listing.imageUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- signed-URL redirect target, cannot be cached by next/image
              <img
                key={url}
                src={url}
                alt={listing.title ?? ''}
                className={`w-full aspect-[4/3] object-cover rounded-lg ${i === 0 ? 'col-span-2 sm:col-span-3' : ''}`}
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            ))}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h1 className="text-2xl font-bold text-slate-900">{listing.title ?? org.name}</h1>
          <p className="text-lg text-slate-700">
            {listing.price ? `${listing.currency} ${Number(listing.price).toLocaleString('es-PE')}` : t('priceOnRequest')}
          </p>
          <p className="text-sm text-slate-500">{listing.zone ?? t('availabilityToConfirm')}</p>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-slate-600 pt-2">
            <div>
              <dt className="text-xs text-slate-400">{t('detail.bedroomsLabel')}</dt>
              <dd>{listing.bedrooms ?? t('availabilityToConfirm')}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">{t('detail.bathroomsLabel')}</dt>
              <dd>{listing.bathrooms ?? t('availabilityToConfirm')}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">{t('detail.areaLabel')}</dt>
              <dd>{listing.areaM2 ? `${listing.areaM2} m²` : t('availabilityToConfirm')}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">{t('detail.maintenanceFeeLabel')}</dt>
              <dd>{listing.maintenanceFee ? `${listing.currency} ${listing.maintenanceFee}` : t('availabilityToConfirm')}</dd>
            </div>
          </dl>

          <p className="text-sm text-slate-500">{listing.parking ? t('detail.parkingYes') : t('detail.parkingNo')}</p>
          <p className="text-sm text-slate-500">
            {listing.petsAllowed === null
              ? t('detail.petsAllowedUnknown')
              : listing.petsAllowed
                ? t('detail.petsAllowedYes')
                : t('detail.petsAllowedNo')}
          </p>

          {listing.description && (
            <p className="text-sm text-slate-700 whitespace-pre-wrap pt-2">{listing.description}</p>
          )}

          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              {t('whatsappCta')}
            </a>
          )}
        </div>

        {org.webPublicKey && (
          <script src="/widget.js" data-key={org.webPublicKey} data-listing-ref={widgetRef} async nonce={nonce} />
        )}
      </div>
    </div>
  );
}
