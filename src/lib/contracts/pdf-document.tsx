/**
 * Contract PDF rendering — browser only.
 *
 * Imported dynamically from pdf-client.ts so @react-pdf/renderer (fontkit,
 * pdfkit, brotli, yoga) never lands in the server / Cloudflare worker bundle.
 */

import React from 'react';
import { Document, Image, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { interpolateTemplate, type ContractPdfSource, type ContractVariables } from './pdf.tsx';
import type { OrgSignature } from './org-signature';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 11,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 50,
    color: '#1e293b',
  },
  heading: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 12,
    color: '#0f172a',
  },
  subheading: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    marginTop: 16,
    marginBottom: 6,
    color: '#1e293b',
  },
  paragraph: {
    lineHeight: 1.6,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  metaLabel: {
    fontFamily: 'Helvetica-Bold',
    width: 140,
  },
  metaValue: {
    flex: 1,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginVertical: 12,
  },
  signatureBlock: {
    marginTop: 32,
    width: 220,
  },
  signatureImage: {
    height: 60,
    objectFit: 'contain',
  },
  signatureLine: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 50,
    right: 50,
    fontSize: 9,
    color: '#94a3b8',
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
  },
});

interface ContractPdfDocProps {
  title: string;
  body: string;
  variables: ContractVariables;
  signature: OrgSignature | null;
}

function LandlordSignature({ signature }: { signature: OrgSignature }) {
  return (
    <View style={styles.signatureBlock} wrap={false}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
      <Image src={signature.imageDataUrl} style={styles.signatureImage} />
      <View style={styles.signatureLine}>
        <Text>{signature.signerName}</Text>
        {signature.signerDocument && <Text>{signature.signerDocument}</Text>}
        <Text>Landlord</Text>
      </View>
    </View>
  );
}

function ContractPdfDocument({ title, body, variables, signature }: ContractPdfDocProps) {
  const paragraphs = body.split(/\n\n+/).filter(p => p.trim().length > 0);

  return (
    <Document title={title} author="PropFlow">
      <Page size="A4" style={styles.page}>
        <View>
          <Text style={styles.heading}>{title}</Text>
          <View style={styles.divider} />
        </View>

        <View style={{ marginBottom: 12 }}>
          {variables.tenant_name && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Tenant:</Text>
              <Text style={styles.metaValue}>{variables.tenant_name}</Text>
            </View>
          )}
          {variables.unit_label && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Unit:</Text>
              <Text style={styles.metaValue}>{variables.unit_label}</Text>
            </View>
          )}
          {variables.property_name && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Property:</Text>
              <Text style={styles.metaValue}>{variables.property_name}</Text>
            </View>
          )}
          {variables.start_date && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Start date:</Text>
              <Text style={styles.metaValue}>{variables.start_date}</Text>
            </View>
          )}
          {variables.end_date && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>End date:</Text>
              <Text style={styles.metaValue}>{variables.end_date}</Text>
            </View>
          )}
          {variables.monthly_rent && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Monthly rent:</Text>
              <Text style={styles.metaValue}>${variables.monthly_rent}</Text>
            </View>
          )}
          {variables.deposit && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Deposit:</Text>
              <Text style={styles.metaValue}>${variables.deposit}</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        {paragraphs.map((para, i) => {
          const trimmed = para.trim();
          if (trimmed.startsWith('## ')) {
            return <Text key={i} style={styles.subheading}>{trimmed.slice(3)}</Text>;
          }
          return <Text key={i} style={styles.paragraph}>{trimmed}</Text>;
        })}

        {signature && <LandlordSignature signature={signature} />}

        <Text style={styles.footer} fixed>
          Generated by PropFlow on {variables.generated_date ?? new Date().toLocaleDateString()} — For reference only
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render a contract template to a PDF Blob.
 */
export async function renderContractPdfBlob(opts: ContractPdfSource): Promise<Blob> {
  const interpolated = interpolateTemplate(opts.bodyMarkdown, opts.variables);
  const doc = (
    <ContractPdfDocument
      title={opts.templateName}
      body={interpolated}
      variables={opts.variables}
      signature={opts.signature}
    />
  );
  return pdf(doc).toBlob();
}
