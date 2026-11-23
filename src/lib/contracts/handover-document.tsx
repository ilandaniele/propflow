/**
 * Check-in / check-out act PDF — browser only, imported on demand like pdf-document.tsx.
 */

import React from 'react';
import { Document, Image, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import type { HandoverActSource } from './handover';
import type { InventoryCondition } from './handover-types';

export type HandoverLabels = {
  title: string;
  contract: string;
  organization: string;
  tenant: string;
  property: string;
  date: string;
  item: string;
  quantity: string;
  condition: string;
  notes: string;
  generalNotes: string;
  landlordSignature: string;
  tenantSignature: string;
  missing: string;
  conditions: Record<InventoryCondition, string>;
};

const styles = StyleSheet.create({
  page:       { fontFamily: 'Helvetica', fontSize: 10, padding: 48, color: '#1e293b' },
  title:      { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 12 },
  row:        { flexDirection: 'row', marginBottom: 4 },
  label:      { width: 120, fontFamily: 'Helvetica-Bold' },
  value:      { flex: 1 },
  table:      { marginTop: 16, borderTopWidth: 1, borderTopColor: '#cbd5e1' },
  tr:         { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingVertical: 4 },
  th:         { fontFamily: 'Helvetica-Bold' },
  name:       { flex: 3, paddingRight: 6 },
  quantity:   { width: 40 },
  condition:  { width: 70 },
  notes:      { flex: 3 },
  general:    { marginTop: 16, lineHeight: 1.5 },
  signatures: { flexDirection: 'row', marginTop: 36, gap: 32 },
  signature:  { flex: 1, borderTopWidth: 1, borderTopColor: '#94a3b8', paddingTop: 6 },
  image:      { height: 60, objectFit: 'contain', marginBottom: 6 },
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function HandoverDocument({ source, labels }: { source: HandoverActSource; labels: HandoverLabels }) {
  const { contract, landlord } = source;
  return (
    <Document title={labels.title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{labels.title}</Text>
        <Row label={labels.contract} value={contract.code ?? labels.missing} />
        <Row label={labels.organization} value={contract.orgName} />
        <Row label={labels.tenant} value={contract.tenant || labels.missing} />
        <Row label={labels.property} value={contract.property || labels.missing} />
        <Row label={labels.date} value={source.createdAt.slice(0, 10)} />
        <View style={styles.table}>
          <View style={[styles.tr, styles.th]}>
            <Text style={styles.name}>{labels.item}</Text>
            <Text style={styles.quantity}>{labels.quantity}</Text>
            <Text style={styles.condition}>{labels.condition}</Text>
            <Text style={styles.notes}>{labels.notes}</Text>
          </View>
          {source.items.map((item, index) => (
            <View key={index} style={styles.tr} wrap={false}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.quantity}>{item.quantity}</Text>
              <Text style={styles.condition}>{labels.conditions[item.condition]}</Text>
              <Text style={styles.notes}>{item.notes ?? ''}</Text>
            </View>
          ))}
        </View>
        {source.notes && <Text style={styles.general}>{`${labels.generalNotes}: ${source.notes}`}</Text>}
        <View style={styles.signatures} wrap={false}>
          <View style={styles.signature}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {landlord && <Image src={landlord.imageDataUrl} style={styles.image} />}
            <Text>{`${labels.landlordSignature}: ${landlord ? landlord.signerName : labels.missing}`}</Text>
          </View>
          <View style={styles.signature}>
            <Text>{`${labels.tenantSignature}: ${contract.tenant || labels.missing}`}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderHandoverPdfBlob(source: HandoverActSource, labels: HandoverLabels): Promise<Blob> {
  return pdf(<HandoverDocument source={source} labels={labels} />).toBlob();
}
