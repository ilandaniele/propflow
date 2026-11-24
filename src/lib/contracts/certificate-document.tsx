/**
 * Signature certificate PDF — browser only, imported on demand like pdf-document.tsx.
 */

import React from 'react';
import { Document, Image, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import type { CertificateSource } from './certificate';

export type CertificateLabels = {
  title: string;
  intro: string;
  contract: string;
  organization: string;
  tenant: string;
  property: string;
  term: string;
  signer: string;
  sentAt: string;
  viewedAt: string;
  signedAt: string;
  ip: string;
  userAgent: string;
  documentHash: string;
  signatureHash: string;
  landlordSignature: string;
  tenantSignature: string;
  missing: string;
};

const styles = StyleSheet.create({
  page:      { fontFamily: 'Helvetica', fontSize: 10, padding: 48, color: '#1e293b' },
  title:     { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 8 },
  intro:     { marginBottom: 16, lineHeight: 1.5, color: '#475569' },
  row:       { flexDirection: 'row', marginBottom: 5 },
  label:     { width: 150, fontFamily: 'Helvetica-Bold' },
  value:     { flex: 1 },
  mono:      { flex: 1, fontFamily: 'Courier', fontSize: 8 },
  signatures: { flexDirection: 'row', marginTop: 28, gap: 32 },
  signature: { flex: 1, borderTopWidth: 1, borderTopColor: '#94a3b8', paddingTop: 6 },
  image:     { height: 60, objectFit: 'contain', marginBottom: 6 },
});

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={mono ? styles.mono : styles.value}>{value}</Text>
    </View>
  );
}

function SignatureBox({ image, caption }: { image: string | null; caption: string }) {
  return (
    <View style={styles.signature}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
      {image && <Image src={image} style={styles.image} />}
      <Text>{caption}</Text>
    </View>
  );
}

function CertificateDocument({ source, labels }: { source: CertificateSource; labels: CertificateLabels }) {
  const { contract, evidence, landlord } = source;
  return (
    <Document title={labels.title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{labels.title}</Text>
        <Text style={styles.intro}>{labels.intro}</Text>
        <Row label={labels.contract} value={contract.code ?? labels.missing} />
        <Row label={labels.organization} value={contract.orgName} />
        <Row label={labels.tenant} value={contract.tenant || labels.missing} />
        <Row label={labels.property} value={contract.property || labels.missing} />
        <Row label={labels.term} value={contract.term || labels.missing} />
        <Row label={labels.signer} value={evidence.signerEmail} />
        <Row label={labels.sentAt} value={evidence.sentAt} />
        <Row label={labels.viewedAt} value={evidence.viewedAt ?? labels.missing} />
        <Row label={labels.signedAt} value={evidence.signedAt ?? labels.missing} />
        <Row label={labels.ip} value={evidence.signedIp ?? labels.missing} />
        <Row label={labels.userAgent} value={evidence.signedUserAgent ?? labels.missing} mono />
        <Row label={labels.documentHash} value={evidence.documentSha256 ?? labels.missing} mono />
        <Row label={labels.signatureHash} value={evidence.signatureSha256 ?? labels.missing} mono />
        <View style={styles.signatures}>
          <SignatureBox
            image={landlord?.imageDataUrl ?? null}
            caption={`${labels.landlordSignature}: ${landlord ? [landlord.signerName, landlord.signerDocument].filter(Boolean).join(' · ') : labels.missing}`}
          />
          <SignatureBox image={source.tenantSignature} caption={`${labels.tenantSignature}: ${contract.tenant || evidence.signerEmail}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderCertificatePdfBlob(source: CertificateSource, labels: CertificateLabels): Promise<Blob> {
  return pdf(<CertificateDocument source={source} labels={labels} />).toBlob();
}
