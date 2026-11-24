import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import {
  changeUtilityHolder,
  createUtilityContract,
  editUtilityContract,
  removeUtilityContract,
} from '@/app/actions/utility-contracts';
import { HOLDER_KINDS, UTILITY_TYPES } from '@/lib/utility-contracts/schemas';
import type { PropertyUtilities, UtilityContractRow } from '@/lib/utility-contracts/queries';
import { ActionForm } from './ActionForm';

type Props = PropertyUtilities & { page: number };
type Translate = (key: string) => string;

const formGrid = 'grid gap-3 sm:grid-cols-2 items-end';
const today = () => new Date().toISOString().slice(0, 10);

function ContractFields({ t, units, contract, prefix }: {
  t: Translate;
  units: PropertyUtilities['units'];
  contract?: UtilityContractRow;
  prefix: string;
}) {
  return (
    <>
      <Select id={`${prefix}_type`} name="utility_type" label={t('type')} defaultValue={contract?.utilityType ?? 'luz'} required>
        {UTILITY_TYPES.map((type) => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
      </Select>
      <Input id={`${prefix}_provider`} name="provider" label={t('provider')} placeholder="Luz del Sur, Sedapal…" defaultValue={contract?.provider} required maxLength={80} />
      <Input id={`${prefix}_supply`} name="supply_number" label={t('supplyNumber')} defaultValue={contract?.supplyNumber ?? ''} maxLength={60} />
      <Select id={`${prefix}_unit`} name="unit_id" label={t('unit')} defaultValue={contract?.unitId ?? ''}>
        <option value="">{t('wholeProperty')}</option>
        {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
      </Select>
      <Input id={`${prefix}_estimate`} name="monthly_estimate" label={t('monthlyEstimate')} type="number" min={0} step="0.01" defaultValue={contract?.monthlyEstimate ?? ''} />
      <Input id={`${prefix}_start`} name="start_date" label={t('startDate')} type="date" defaultValue={contract?.startDate ?? ''} />
      <div className="sm:col-span-2">
        <Textarea id={`${prefix}_notes`} name="notes" label={t('notes')} defaultValue={contract?.notes ?? ''} maxLength={1000} />
      </div>
    </>
  );
}

function HolderFields({ t, prefix }: { t: Translate; prefix: string }) {
  return (
    <>
      <Select id={`${prefix}_holder_kind`} name="holder_kind" label={t('holderKind')} defaultValue="owner" required>
        {HOLDER_KINDS.map((kind) => <option key={kind} value={kind}>{t(`holderKinds.${kind}`)}</option>)}
      </Select>
      <Input id={`${prefix}_holder_name`} name="holder_name" label={t('holderName')} required maxLength={120} />
    </>
  );
}

function ContractItem({ t, contract, units }: { t: Translate; contract: UtilityContractRow; units: PropertyUtilities['units'] }) {
  const prefix = `uc_${contract.id}`;
  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {t(`types.${contract.utilityType}`)} · {contract.provider}
            {contract.supplyNumber && <span className="text-slate-500"> · {t('supplyShort')} {contract.supplyNumber}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {t('holder')}: {contract.holderName} ({t(`holderKinds.${contract.holderKind}`)})
            {' · '}{contract.unitLabel ?? t('wholeProperty')}
            {contract.monthlyEstimate != null && <> · S/ {Number(contract.monthlyEstimate).toLocaleString('es-PE', { minimumFractionDigits: 2 })}{t('perMonth')}</>}
            {contract.startDate && <> · {t('since')} {contract.startDate}</>}
          </p>
          {contract.notes && <p className="mt-1 text-xs text-slate-600 whitespace-pre-line">{contract.notes}</p>}
        </div>
        <ActionForm action={removeUtilityContract} submitLabel={t('remove')} pendingLabel={t('saving')} danger>
          <input type="hidden" name="id" value={contract.id} />
        </ActionForm>
      </div>

      {contract.changes.length > 0 && (
        <ul className="ml-3 border-l border-slate-200 pl-3 text-xs text-slate-500">
          {contract.changes.map((change) => (
            <li key={change.id}>
              {change.changedOn}: {change.fromHolder} → {change.toHolder}{change.reason && ` (${change.reason})`}
            </li>
          ))}
        </ul>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-blue-600">{t('changeHolder')}</summary>
        <ActionForm action={changeUtilityHolder} submitLabel={t('saveChange')} pendingLabel={t('saving')} className={`${formGrid} mt-2`}>
          <input type="hidden" name="id" value={contract.id} />
          <HolderFields t={t} prefix={`${prefix}_change`} />
          <Input id={`${prefix}_changed_on`} name="changed_on" label={t('changedOn')} type="date" defaultValue={today()} required />
          <Input id={`${prefix}_reason`} name="reason" label={t('reason')} placeholder={t('reasonPlaceholder')} maxLength={300} />
        </ActionForm>
      </details>

      <details className="text-sm">
        <summary className="cursor-pointer text-blue-600">{t('edit')}</summary>
        <ActionForm action={editUtilityContract} submitLabel={t('save')} pendingLabel={t('saving')} className={`${formGrid} mt-2`}>
          <input type="hidden" name="id" value={contract.id} />
          <ContractFields t={t} units={units} contract={contract} prefix={`${prefix}_edit`} />
        </ActionForm>
      </details>
    </li>
  );
}

export async function UtilityContractsSection({ property, units, contracts, hasMore, page }: Props) {
  const t = await getTranslations('utilityContracts');
  const pageHref = (target: number) => `/dashboard/properties/${property.id}?tab=utilities&page=${target}`;

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <Link href="/dashboard/finance/utilities" className="text-sm text-blue-600 hover:underline">{t('splitLink')}</Link>
        </CardHeader>
        <p className="mb-2 text-sm text-slate-500">{t('subtitle')}</p>

        {contracts.length === 0 ? (
          <p className="mb-4 text-sm text-slate-400">{t('empty')}</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {contracts.map((contract) => <ContractItem key={contract.id} t={t} contract={contract} units={units} />)}
          </ul>
        )}

        {(page > 1 || hasMore) && (
          <nav className="mb-4 flex justify-between text-sm" aria-label={t('pagination')}>
            {page > 1 ? <Link href={pageHref(page - 1)} className="text-blue-600 hover:underline">{t('previous')}</Link> : <span />}
            {hasMore && <Link href={pageHref(page + 1)} className="text-blue-600 hover:underline">{t('next')}</Link>}
          </nav>
        )}

        <details className="border-t border-slate-100 pt-4 text-sm">
          <summary className="cursor-pointer font-medium text-slate-900">{t('add')}</summary>
          <ActionForm action={createUtilityContract} submitLabel={t('add')} pendingLabel={t('saving')} className={`${formGrid} mt-3`}>
            <input type="hidden" name="property_id" value={property.id} />
            <ContractFields t={t} units={units} prefix="uc_new" />
            <HolderFields t={t} prefix="uc_new" />
          </ActionForm>
        </details>
      </Card>
    </div>
  );
}
