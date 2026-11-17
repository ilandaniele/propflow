/**
 * Columns that still hold an expiring Airtable attachment URL, and where the
 * Airtable value comes from. Pure data — one-off migration, delete together
 * with the Airtable integration.
 *
 * `airtableTable` is the name of the env var that holds the Airtable table id
 * (the same keys the sync cron reads); it is resolved at runtime.
 */

export interface AttachmentColumn {
  dbTable: string;
  dbColumn: string;
  idColumn: 'airtable_external_id' | 'airtable_id';
  airtableTable: string;
  airtableField: string;
  bucket: string;
}

export const ATTACHMENT_COLUMNS: readonly AttachmentColumn[] = [
  { dbTable: 'responsables',       dbColumn: 'photo_url',    idColumn: 'airtable_external_id', airtableTable: 'AIRTABLE_TABLE_RESPONSABLES', airtableField: 'Foto DNI',         bucket: 'tenant-avatars' },
  { dbTable: 'tenants',            dbColumn: 'photo_url',    idColumn: 'airtable_external_id', airtableTable: 'AIRTABLE_TABLE_RESIDENTES',   airtableField: 'Foto DNI',         bucket: 'tenant-avatars' },
  { dbTable: 'payments',           dbColumn: 'receipt_url',  idColumn: 'airtable_external_id', airtableTable: 'AIRTABLE_TABLE_PAGOS',        airtableField: 'Comprobante',      bucket: 'receipts' },
  { dbTable: 'account_statements', dbColumn: 'pdf_url',      idColumn: 'airtable_id',          airtableTable: 'AIRTABLE_TABLE_EECC',         airtableField: 'PDF',              bucket: 'contracts' },
  { dbTable: 'tax_receipts',       dbColumn: 'file_url',     idColumn: 'airtable_id',          airtableTable: 'AIRTABLE_TABLE_IMPUESTOS',    airtableField: 'Archivo',          bucket: 'receipts' },
  { dbTable: 'trash_compliance',   dbColumn: 'foto_url',     idColumn: 'airtable_external_id', airtableTable: 'AIRTABLE_TABLE_CUMPL_BASURA', airtableField: 'Foto',             bucket: 'task-proofs' },
  { dbTable: 'contracts',          dbColumn: 'document_url', idColumn: 'airtable_external_id', airtableTable: 'AIRTABLE_TABLE_HISTORIAL',    airtableField: 'Contrato firmado', bucket: 'contracts' },
];

/** `airtable_snapshots.table_name` -> env var holding that Airtable table id. */
export const SNAPSHOT_TABLE_ENV: Readonly<Record<string, string>> = {
  propiedades:            'AIRTABLE_TABLE_PROPIEDADES',
  residentes:             'AIRTABLE_TABLE_RESIDENTES',
  historial:              'AIRTABLE_TABLE_HISTORIAL',
  movimientos:            'AIRTABLE_TABLE_PAGOS',
  portafolio:             'AIRTABLE_TABLE_PORTAFOLIO',
  mantenimiento:          'AIRTABLE_TABLE_MANTENIMIENTO',
  responsables:           'AIRTABLE_TABLE_RESPONSABLES',
  pago_servicios:         'AIRTABLE_TABLE_PAGO_SERVICIOS',
  adicionales:            'AIRTABLE_TABLE_ADICIONALES',
  eecc:                   'AIRTABLE_TABLE_EECC',
  impuestos_comprobantes: 'AIRTABLE_TABLE_IMPUESTOS',
  feedback:               'AIRTABLE_TABLE_FEEDBACK',
  propietarios:           'AIRTABLE_TABLE_PROPIETARIOS',
  cuentas_deposito:       'AIRTABLE_TABLE_CUENTAS_DEPOSITO',
  turnos_basura:          'AIRTABLE_TABLE_TURNOS_BASURA',
  cumplimiento_basura:    'AIRTABLE_TABLE_CUMPL_BASURA',
  ausencias:              'AIRTABLE_TABLE_AUSENCIAS',
};

/** Snapshot table whose records are units (`units.airtable_external_id`). */
export const UNIT_SNAPSHOT_TABLE = 'portafolio';

export const ARCHIVE_BUCKET = 'contracts';
export const ARCHIVE_PREFIX = 'airtable-archive';
export const MANIFEST_PATH = `${ARCHIVE_PREFIX}/manifest.json`;
export const UNIT_IMAGES_BUCKET = 'unit-images';
