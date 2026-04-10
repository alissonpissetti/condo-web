/** Formata centavos (inteiro) para moeda BRL. */
export function formatCentsBrl(cents: string | number): string {
  const n = typeof cents === 'string' ? parseInt(cents, 10) : cents;
  if (Number.isNaN(n)) {
    return '—';
  }
  return (n / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/** Valor em reais (ex.: 12.5) para centavos inteiros. */
export function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}
