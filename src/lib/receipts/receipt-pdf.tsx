import React from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import type { PaymentReceipt } from './payment-receipt';
import { formatReceiptAmount } from './format';

export interface ReceiptLabels {
  title: string;
  number: string;
  receivedFrom: string;
  property: string;
  unit: string;
  date: string;
  method: string;
  concept: string;
  reference: string;
  amount: string;
  footer: string;
}

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 11, padding: 50, color: '#1e293b' },
  org: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  number: { fontSize: 10, color: '#64748b', marginTop: 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: '#e2e8f0', marginVertical: 16 },
  row: { flexDirection: 'row', marginBottom: 6 },
  label: { width: 140, color: '#64748b' },
  value: { flex: 1 },
  total: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, padding: 12, backgroundColor: '#f1f5f9' },
  totalValue: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 40, left: 50, right: 50, fontSize: 9, color: '#94a3b8', textAlign: 'center' },
});

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function ReceiptDocument({ receipt, labels }: { receipt: PaymentReceipt; labels: ReceiptLabels }) {
  const amount = formatReceiptAmount(receipt);
  return (
    <Document title={receipt.number}>
      <Page size="A5" style={styles.page}>
        <Text style={styles.org}>{receipt.orgName}</Text>
        <Text style={styles.title}>{labels.title}</Text>
        <Text style={styles.number}>{labels.number} {receipt.number}</Text>
        <View style={styles.divider} />
        <Row label={labels.receivedFrom} value={receipt.tenantName} />
        <Row label={labels.property} value={receipt.propertyName} />
        <Row label={labels.unit} value={receipt.unitLabel} />
        <Row label={labels.date} value={receipt.paidAt} />
        <Row label={labels.method} value={receipt.method} />
        <Row label={labels.concept} value={receipt.concept} />
        <Row label={labels.reference} value={receipt.reference} />
        <View style={styles.total}>
          <Text>{labels.amount}</Text>
          <Text style={styles.totalValue}>{amount}</Text>
        </View>
        <Text style={styles.footer} fixed>{labels.footer}</Text>
      </Page>
    </Document>
  );
}

export function renderReceiptPdfBlob(receipt: PaymentReceipt, labels: ReceiptLabels): Promise<Blob> {
  return pdf(<ReceiptDocument receipt={receipt} labels={labels} />).toBlob();
}
