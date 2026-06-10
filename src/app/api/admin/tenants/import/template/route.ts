/**
 * GET /api/admin/tenants/import/template
 * Returns CSV template for tenant import.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';

const CSV_TEMPLATE = `# PropFlow - Plantilla de Importacion de Inquilinos
# Fecha: formato YYYY-MM-DD (ejemplo: 1990-05-15)
# Estado aceptado: active, inactive, pending
# Idioma: es (espanol), en (ingles)
# El campo external_tenant_id es opcional. Si se proporciona, se usa para actualizar registros existentes.
# Si el email ya existe en PropFlow, el registro se actualiza (no se crea uno nuevo).
# Los inquilinos importados no reciben acceso al portal automaticamente. El administrador debe enviar una invitacion.
# La asignacion de propiedad, habitacion y contrato se gestiona por separado despues de la importacion.
external_tenant_id,first_name,last_name,email,phone,document_number,date_of_birth,emergency_contact_name,emergency_contact_phone,status,move_in_date,preferred_language
,Juan,Garcia,juan.garcia@email.com,+51999888777,12345678,1990-05-15,Maria Garcia,+51999888111,active,2026-01-01,es
`;

export async function GET(): Promise<NextResponse> {
  try { await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  return new NextResponse(CSV_TEMPLATE, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="tenant-import-template.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
