/**
 * Tenant self-registration schema — used by:
 * - POST /api/tenant/register (server-side validation)
 * - /onboarding?type=tenant form (client-side field list / error messages)
 *
 * This schema is the single source of truth for what a new tenant must supply
 * during Google-OAuth-based onboarding. Admin-only fields (property, unit,
 * contract, rent, deposit) are intentionally excluded.
 */

import { z } from 'zod';

export const tenantRegistrationSchema = z.object({
  // Mandatory personal fields
  first_name: z.string().min(1, 'El nombre es requerido').max(100),
  last_name:  z.string().min(1, 'El apellido es requerido').max(100),
  email:      z.string().email('Correo electrónico inválido').transform(v => v.trim().toLowerCase()),
  phone:      z.string().min(6, 'Número celular inválido').max(20),
  dni:        z.string().min(5, 'DNI inválido').max(20),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida — usa el formato AAAA-MM-DD'),

  // Optional emergency contact
  emergency_contact_name:  z.string().max(100).optional(),
  emergency_contact_phone: z.string().max(20).optional(),

  // Terms acceptance (mandatory — must be exactly true)
  terms_accepted:   z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los términos' }) }),
  privacy_accepted: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar la política de privacidad' }) }),
});

export type TenantRegistrationInput = z.infer<typeof tenantRegistrationSchema>;

/** Human-readable field labels for the Spanish UI. */
export const tenantRegistrationLabels: Record<keyof TenantRegistrationInput, string> = {
  first_name:               'Nombre(s)',
  last_name:                'Apellido(s)',
  email:                    'Correo electrónico',
  phone:                    'Número celular',
  dni:                      'N° de DNI',
  birth_date:               'Fecha de nacimiento',
  emergency_contact_name:   'Nombre del contacto de emergencia (opcional)',
  emergency_contact_phone:  'Teléfono del contacto de emergencia (opcional)',
  terms_accepted:           'Acepto los Términos y Condiciones',
  privacy_accepted:         'Acepto la Política de Privacidad',
};
