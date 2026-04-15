/** Formata centavos como moeda brasileira (ex.: R$ 12,50). */
export function formatBrlFromCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
