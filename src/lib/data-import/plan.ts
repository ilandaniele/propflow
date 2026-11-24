import { OwnerRowSchema, PropertyRowSchema, UnitRowSchema, type DataImportKind } from './schemas';

export type PlannedStatus = 'new' | 'duplicate' | 'invalid' | 'unknown_property';

export interface PlannedRow {
  rowNumber: number;
  status:    PlannedStatus;
  label:     string;
  fields?:   string[];
  values?:   Record<string, string | number | null>;
}

export interface ExistingKeys {
  propertyIdsByName: Map<string, string>;
  keys:              Set<string>;
}

export const normalize = (value: string) => value.trim().toLowerCase();
export const unitKey = (propertyId: string, label: string) => `${propertyId}|${normalize(label)}`;
export const ownerKeys = (name: string | null, dni: string | null) => [
  ...(dni ? [`dni:${normalize(dni)}`] : []),
  ...(name ? [`name:${normalize(name)}`] : []),
];

type Planned = Pick<PlannedRow, 'status' | 'label' | 'values'> & { key?: string };

function planProperty(raw: unknown): Planned | string[] {
  const parsed = PropertyRowSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((issue) => String(issue.path[0]));
  const row = parsed.data;
  return {
    status: 'new',
    label:  row.name,
    key:    normalize(row.name),
    values: { name: row.name, address: row.address ?? null, city: row.city ?? null, district: row.district ?? null, country: row.country ?? null },
  };
}

function planUnit(raw: unknown, existing: ExistingKeys): Planned | string[] {
  const parsed = UnitRowSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((issue) => String(issue.path[0]));
  const row = parsed.data;
  const label = `${row.property_name} · ${row.label}`;
  const propertyId = existing.propertyIdsByName.get(normalize(row.property_name));
  if (!propertyId) return { status: 'unknown_property', label };
  return {
    status: 'new',
    label,
    key:    unitKey(propertyId, row.label),
    values: {
      propertyId,
      label:              row.label,
      floor:              row.floor ?? null,
      bedrooms:           row.bedrooms ?? null,
      monthlyRentDefault: row.monthly_rent ?? null,
      toiletType:         row.toilet_type ?? 'private',
    },
  };
}

function planOwner(raw: unknown): Planned | string[] {
  const parsed = OwnerRowSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((issue) => String(issue.path[0]));
  const row = parsed.data;
  return {
    status: 'new',
    label:  row.name,
    key:    row.dni ? `dni:${normalize(row.dni)}` : `name:${normalize(row.name)}`,
    values: {
      name:      row.name,
      dni:       row.dni ?? null,
      phone:     row.phone ?? null,
      email:     row.email ?? null,
      domicilio: row.domicilio ?? null,
      distrito:  row.distrito ?? null,
    },
  };
}

const PLANNERS: Record<DataImportKind, (raw: unknown, existing: ExistingKeys) => Planned | string[]> = {
  properties: planProperty,
  units:      planUnit,
  owners:     planOwner,
};

export function planImport(kind: DataImportKind, rawRows: Record<string, unknown>[], existing: ExistingKeys): PlannedRow[] {
  const seen = new Set(existing.keys);
  return rawRows.map((raw, index) => {
    const rowNumber = index + 1;
    const planned = PLANNERS[kind](raw, existing);
    if (Array.isArray(planned)) {
      return { rowNumber, status: 'invalid', label: String(Object.values(raw)[0] ?? ''), fields: [...new Set(planned)] };
    }
    const { key, ...row } = planned;
    if (key && seen.has(key)) return { rowNumber, status: 'duplicate', label: row.label };
    if (key) seen.add(key);
    return { rowNumber, ...row };
  });
}
