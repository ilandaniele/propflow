/**
 * GET /api/admin/payments/import/template
 * Returns a CSV template for payment import (admin version).
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';

const CSV_TEMPLATE = `# PropFlow - Plantilla de Importacion de Pagos (Admin)
# Fecha: formato YYYY-MM-DD (ejemplo: 2026-06-01)
# Montos: formato decimal con punto (ejemplo: 850.00). Sin simbolos de moneda.
# Moneda aceptada: PEN, USD, EUR (por defecto PEN)
# Estado aceptado: pending, approved, under_review (por defecto pending)
# Metodo de pago: cash, transfer, card, other (por defecto transfer)
# Campos obligatorios: payment_date, amount
# El campo external_payment_id debe ser unico. Re-importar la misma fila actualiza el registro existente.
external_payment_id,tenant_email,payment_date,due_date,amount,currency,status,payment_method,billing_period,property,unit,reference,description
PAY-2026-001,inquilino@email.com,2026-06-01,2026-06-05,850.00,PEN,pending,transfer,2026-06,Casa Aurora,Hab 101,REF-001,Renta junio 2026
`;

export async function GET(): Promise<NextResponse> {
  try { await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  return new NextResponse(CSV_TEMPLATE, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="payment-import-template-admin.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
