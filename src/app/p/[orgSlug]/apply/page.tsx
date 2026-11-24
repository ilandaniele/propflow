import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPublicOrg } from '@/lib/public/catalog';
import { rentListingBySlug } from '@/lib/applications/service';
import { APPLICATION_DOCUMENT_MIME_TYPES, MAX_APPLICATION_DOCUMENTS } from '@/lib/applications/documents';
import { submitRentalApplication } from '@/app/actions/rental-application';
import { ApplicationForm } from './ApplicationForm';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface PageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ listing?: string }>;
}

export default async function RentalApplicationPage({ params, searchParams }: PageProps) {
  const [{ orgSlug }, { listing: listingSlug }] = await Promise.all([params, searchParams]);
  const org = await getPublicOrg(orgSlug);
  if (!org) notFound();

  const [listing, t] = await Promise.all([
    listingSlug ? rentListingBySlug(org.id, listingSlug) : null,
    getTranslations('rentalApplication'),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <a href={listing && listingSlug ? `/p/${org.slug}/${listingSlug}` : `/p/${org.slug}`} className="text-sm text-brand-600 hover:underline">
          ← {t('back')}
        </a>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {listing?.title ? t('subtitleListing', { listing: listing.title, org: org.name }) : t('subtitle', { org: org.name })}
          </p>
        </div>
        <ApplicationForm
          action={submitRentalApplication.bind(null, org.slug)}
          listingSlug={listing ? listingSlug ?? '' : ''}
          accept={APPLICATION_DOCUMENT_MIME_TYPES.join(',')}
          maxDocuments={MAX_APPLICATION_DOCUMENTS}
        />
      </div>
    </div>
  );
}
