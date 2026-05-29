// Re-export from the TSX PDF module for use in server actions
export type { ContractVariables, AllowedVariable } from './pdf.tsx';
export { ALLOWED_VARIABLES, interpolateTemplate, generateContractPdfBuffer } from './pdf.tsx';
