export const formatSoles = (amount: string) =>
  `S/ ${Number(amount).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
