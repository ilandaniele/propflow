import type { OrgSignature } from './org-signature';
import type { SignatureEvidence } from './signature-evidence';

export type CertificateSource = {
  contract: { code: string | null; orgName: string; tenant: string; property: string; term: string };
  evidence: SignatureEvidence;
  tenantSignature: string | null;
  landlord: OrgSignature | null;
};
