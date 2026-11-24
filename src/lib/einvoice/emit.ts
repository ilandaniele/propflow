import type { EmitEinvoiceInput } from '@/lib/schemas/einvoice';
import { DEFAULT_SERIES, splitIgv, validateCustomerDoc, type CustomerDocError } from './calc';
import { selectProvider, type EmitStatus } from './providers';
import { findChargeForEinvoice, reserveEinvoice, saveEmitResult } from './queries';

export type EmitOutcome =
  | { kind: 'ok'; id: string; status: EmitStatus }
  | { kind: 'not_found' }
  | { kind: 'already_emitted' }
  | { kind: 'invalid_customer'; reason: CustomerDocError };

const isDuplicateCharge = (e: unknown) => e instanceof Error && e.message.includes('einvoices.charge_id');

export async function emitEinvoice(orgId: string, input: EmitEinvoiceInput): Promise<EmitOutcome> {
  const charge = await findChargeForEinvoice(orgId, input.charge_id);
  if (!charge) return { kind: 'not_found' };
  if (charge.einvoiceId) return { kind: 'already_emitted' };

  const amounts = splitIgv(charge.amount);
  const reason = validateCustomerDoc(input.doc_type, input.customer_doc_type, input.customer_doc_number, Number(amounts.total));
  if (reason) return { kind: 'invalid_customer', reason };

  const provider = selectProvider();
  const draft = {
    ...amounts,
    orgId,
    chargeId: charge.id,
    docType: input.doc_type,
    series: DEFAULT_SERIES[input.doc_type],
    customerDocType: input.customer_doc_type,
    customerDocNumber: input.customer_doc_type === 'none' ? null : input.customer_doc_number,
    customerName: input.customer_name,
    provider: provider.name,
  };

  let reserved;
  try {
    reserved = await reserveEinvoice(draft);
  } catch (e) {
    if (isDuplicateCharge(e)) return { kind: 'already_emitted' };
    throw e;
  }

  const result = await provider.emit({
    ...draft,
    number: reserved.number,
    description: charge.description || ['Alquiler', charge.period].filter(Boolean).join(' '),
    issueDate: new Date(),
  });
  await saveEmitResult(reserved.id, result);
  return { kind: 'ok', id: reserved.id, status: result.status };
}
