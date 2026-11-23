import type { AllowedVariable } from './pdf.tsx';

export const SAMPLE_VARIABLES: Record<AllowedVariable, string> = {
  tenant_name: 'Ana Pérez',
  tenant_email: 'ana@example.com',
  tenant_phone: '+51 987 654 321',
  tenant_document: '12345678',
  unit_label: 'Hab. 3',
  property_name: 'Casa Miraflores',
  property_address: 'Av. Ejemplo 123',
  property_district: 'Miraflores',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  duration_months: '12',
  monthly_rent: '1500',
  deposit: '1500',
  payment_day: '5',
  contract_code: 'CTR-0001',
  org_name: 'Inmobiliaria Ejemplo',
  landlord_name: 'Juan Gómez',
  landlord_document: '87654321',
  generated_date: '2026-01-01',
};
