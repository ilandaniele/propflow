/**
 * Contract PDF generation — IC-B1 (JSX/TSX file for @react-pdf/renderer)
 *
 * Uses @react-pdf/renderer (pure JS, serverless-friendly).
 * Variables are a FIXED ALLOWLIST resolved from DB — no user template execution.
 * The allowlist prevents template injection (OWASP A05).
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';

// ── Allowed template variables ────────────────────────────────────────────────
export const ALLOWED_VARIABLES = [
  'tenant_name',
  'tenant_email',
  'unit_label',
  'property_name',
  'property_address',
  'start_date',
  'end_date',
  'monthly_rent',
  'deposit',
  'org_name',
  'generated_date',
] as const;

export type AllowedVariable = typeof ALLOWED_VARIABLES[number];

export interface ContractVariables {
  tenant_name?: string;
  tenant_email?: string;
  unit_label?: string;
  property_name?: string;
  property_address?: string;
  start_date?: string;
  end_date?: string;
  monthly_rent?: string;
  deposit?: string;
  org_name?: string;
  generated_date?: string;
}

/**
 * Interpolate template variables in a markdown body.
 * Only allowlisted {{variable}} tokens are replaced.
 */
export function interpolateTemplate(
  bodyMarkdown: string,
  variables: ContractVariables
): string {
  let result = bodyMarkdown;
  for (const key of ALLOWED_VARIABLES) {
    const value = variables[key] ?? `{{${key}}}`;
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

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
}

function ContractPdfDocument({ title, body, variables }: ContractPdfDocProps) {
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

        <Text style={styles.footer} fixed>
          Generated by PropFlow on {variables.generated_date ?? new Date().toLocaleDateString()} — For reference only
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Generate a PDF buffer from a contract template.
 */
export async function generateContractPdfBuffer(opts: {
  templateName: string;
  bodyMarkdown: string;
  variables: ContractVariables;
}): Promise<Uint8Array> {
  const interpolated = interpolateTemplate(opts.bodyMarkdown, opts.variables);
  const doc = (
    <ContractPdfDocument
      title={opts.templateName}
      body={interpolated}
      variables={opts.variables}
    />
  );
  const pdfBlob = await pdf(doc).toBlob();
  const arrayBuffer = await pdfBlob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}
