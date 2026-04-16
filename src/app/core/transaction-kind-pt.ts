/** Rótulo em pt-BR para `kind` de transação financeira. */
export function transactionKindLabelPt(kind: string): string {
  switch (kind) {
    case 'expense':
      return 'Despesa';
    case 'investment':
      return 'Investimento';
    case 'income':
      return 'Receita';
    default:
      return kind;
  }
}
