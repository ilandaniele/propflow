-- Migration 039: Add Airtable-mapped domain columns to the four main entity tables.
--
-- All columns are nullable (no NOT NULL constraints) so existing rows are unaffected.
-- Idempotent via ADD COLUMN IF NOT EXISTS.
--
-- Column decisions are documented in implementation-notes.md.

-- ─── properties ──────────────────────────────────────────────────────────────
-- Airtable Propiedades fields: Distrito, Modalidad, N° de suministro luz,
-- N° total de habitaciones, N° de residentes actuales, Descripción
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS district            TEXT,
  ADD COLUMN IF NOT EXISTS modality            TEXT,
  ADD COLUMN IF NOT EXISTS supply_number_luz   TEXT,
  ADD COLUMN IF NOT EXISTS total_rooms         INTEGER,
  ADD COLUMN IF NOT EXISTS current_residents   INTEGER,
  ADD COLUMN IF NOT EXISTS description         TEXT;

-- ─── tenants ─────────────────────────────────────────────────────────────────
-- Airtable Residentes fields: Codigo, Nombre, Apellido, N° DNI, Fecha de nacimiento,
-- Fecha de pago (payment_due_day), Renta (monthly_rent), Garantía (deposit),
-- Estado (tenant_status), Fecha inicio contrato, Fecha fin contrato, Duración meses
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS codigo            TEXT,
  ADD COLUMN IF NOT EXISTS first_name        TEXT,
  ADD COLUMN IF NOT EXISTS last_name         TEXT,
  ADD COLUMN IF NOT EXISTS dni               TEXT,
  ADD COLUMN IF NOT EXISTS birth_date        DATE,
  ADD COLUMN IF NOT EXISTS payment_due_day   INTEGER,
  ADD COLUMN IF NOT EXISTS monthly_rent      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS deposit           NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tenant_status     TEXT,
  ADD COLUMN IF NOT EXISTS contract_start    DATE,
  ADD COLUMN IF NOT EXISTS contract_end      DATE,
  ADD COLUMN IF NOT EXISTS duration_months   INTEGER;

-- ─── contracts ───────────────────────────────────────────────────────────────
-- Airtable Historial fields: Código contrato, Tipo de contrato,
-- Duración meses, URL recibo depósito
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_code         TEXT,
  ADD COLUMN IF NOT EXISTS contract_type         TEXT,
  ADD COLUMN IF NOT EXISTS duration_months       INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_receipt_url   TEXT;

-- ─── payments ────────────────────────────────────────────────────────────────
-- Airtable Pagos fields: Nombre registro, Mes/período, Fecha vencimiento,
-- Teléfono, Nombre inquilino (denormalised text from linked record)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS name          TEXT,
  ADD COLUMN IF NOT EXISTS period_month  TEXT,
  ADD COLUMN IF NOT EXISTS due_date      DATE,
  ADD COLUMN IF NOT EXISTS phone         TEXT,
  ADD COLUMN IF NOT EXISTS tenant_name   TEXT;
