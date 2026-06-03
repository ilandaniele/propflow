-- Migration: expand incidents.category CHECK constraint
-- Adds material_damage and malfunction while preserving all 6 legacy categories.

-- Step 1: drop the existing CHECK constraint (name found from schema: incidents_category_check)
ALTER TABLE public.incidents
  DROP CONSTRAINT IF EXISTS incidents_category_check;

-- Step 2: add the new CHECK constraint with all 8 allowed values
ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_category_check
    CHECK (category IN (
      'plumbing',
      'electrical',
      'appliance',
      'structural',
      'cleaning',
      'other',
      'material_damage',
      'malfunction'
    ));
