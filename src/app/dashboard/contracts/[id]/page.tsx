import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contracts, contractTemplates, properties, tenants, units } from '@/lib/db/schema';
import { getSignedUrl } from '@/lib/storage';
import { listContractSignatureRequests } from '@/lib/contracts/signature-requests';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { ContractDocumentPanel } from './ContractDocumentPanel';
import { SignatureEvidenceList } from './SignatureEvidenceList';

export const metadata: Metadata = { title: 'Contract' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ContractDetailPage({ params }: Props) {
  const { id } = await params;
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [[contract], templates, requests, t] = await Promise.all([
    db
      .select({
        id:              contracts.id,
        status:          contracts.status,
        contractCode:    contracts.contractCode,
        startDate:       contracts.startDate,
        endDate:         contracts.endDate,
        monthlyRent:     contracts.monthlyRent,
        documentUrl:     contracts.documentUrl,
        signatureStatus: contracts.signatureStatus,
        tenantName:      tenants.fullName,
        tenantEmail:     tenants.email,
        unitLabel:       units.label,
        propertyName:    properties.name,
      })
      .from(contracts)
      .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
      .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, ctx.orgId)))
      .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, ctx.orgId)))
      .where(and(eq(contracts.id, id), eq(contracts.orgId, ctx.orgId)))
      .limit(1),
    db
      .select({ id: contractTemplates.id, name: contractTemplates.name })
      .from(contractTemplates)
      .where(eq(contractTemplates.orgId, ctx.orgId))
      .orderBy(asc(contractTemplates.name)),
    listContractSignatureRequests(ctx.orgId, id),
    getTranslations('contractDetail'),
  ]);

  if (!contract) notFound();

  const documentLink = contract.documentUrl
    ? await getSignedUrl('contracts', contract.documentUrl, 900).catch(() => null)
    : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link href="/dashboard/contracts" className="text-sm text-slate-500 hover:text-slate-700">← {t('back')}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{contract.tenantName ?? '—'}</h1>
          <StatusPill status={contract.status} />
          {contract.signatureStatus && <StatusPill status={contract.signatureStatus} />}
        </div>
        <p className="text-sm text-slate-500 mt-1">
          {[contract.contractCode, contract.propertyName, contract.unitLabel].filter(Boolean).join(' · ')}
          {' · '}{contract.startDate} → {contract.endDate ?? '—'}
          {' · '}S/ {Number(contract.monthlyRent).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('documentTitle')}</CardTitle></CardHeader>
        <ContractDocumentPanel
          contractId={contract.id}
          templates={templates}
          documentLink={documentLink}
          tenantEmail={contract.tenantEmail}
        />
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('signaturesTitle')}</CardTitle></CardHeader>
        <SignatureEvidenceList requests={requests} />
      </Card>
    </div>
  );
}
