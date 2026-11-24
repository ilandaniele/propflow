import type { OrgSignature } from './org-signature';
import type { SignatureEvidence } from './signature-evidence';
import type { ContractHeader } from './contract-header';

export type CertificateSource = {
  contract: ContractHeader;
  evidence: SignatureEvidence;
  tenantSignature: string | null;
  landlord: OrgSignature | null;
};
