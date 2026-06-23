-- Migration: add new Airtable-mapped fields to existing tables
-- Safe to run multiple times (IF NOT EXISTS guards)

-- ── contracts ────────────────────────────────────────────────────────────────
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS actual_exit_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_contract_url TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS exit_reason TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS penalty_applied BOOLEAN DEFAULT FALSE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS penalty_amount NUMERIC(12,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deposit_returned NUMERIC(12,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS exit_debt NUMERIC(12,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS cleaning_fee_status TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS has_glp BOOLEAN DEFAULT FALSE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS actual_close_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS keynua_contract_id TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS payment_status TEXT;

-- ── payments (movimientos) ────────────────────────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS previous_balance_applied NUMERIC(12,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS previous_addl_balance_applied NUMERIC(12,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS days_overdue INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS concept TEXT;

-- ── units (portafolio) ────────────────────────────────────────────────────────
ALTER TABLE units ADD COLUMN IF NOT EXISTS unit_type TEXT;
ALTER TABLE units ADD COLUMN IF NOT EXISTS price_6months NUMERIC(12,2);
ALTER TABLE units ADD COLUMN IF NOT EXISTS price_12months NUMERIC(12,2);
ALTER TABLE units ADD COLUMN IF NOT EXISTS price_18months NUMERIC(12,2);

-- ── properties ────────────────────────────────────────────────────────────────
ALTER TABLE properties ADD COLUMN IF NOT EXISTS folder_id TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS gas_type TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS n_pe TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS modality TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS total_rooms INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS supply_number_luz TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS n_suministro_agua TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS n_cliente_gas TEXT;

-- ── tenants ───────────────────────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS occupation TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS foto_tiu_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS solvency_doc_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS acquisition_channels TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS exit_reason TEXT;

-- ── trash_compliance ──────────────────────────────────────────────────────────
ALTER TABLE trash_compliance ADD COLUMN IF NOT EXISTS registro_tipo TEXT;
ALTER TABLE trash_compliance ADD COLUMN IF NOT EXISTS problema_descripcion TEXT;
