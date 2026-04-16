export type FormatCentsBrlOptions = {
  /** Se true, formata sempre como valor positivo (módulo), sem prefixo «-». */
  absolute?: boolean;
};

/** Formata centavos (inteiro) para moeda BRL. Usa BigInt para não perder precisão em valores grandes. */
export function formatCentsBrl(
  cents: string | number | bigint,
  options?: FormatCentsBrlOptions,
): string {
  try {
    let bi: bigint;
    if (typeof cents === 'bigint') {
      bi = cents;
    } else if (typeof cents === 'number') {
      if (!Number.isFinite(cents)) {
        return '—';
      }
      bi = BigInt(Math.trunc(cents));
    } else {
      const s = String(cents ?? '').trim();
      if (s === '' || !/^-?\d+$/.test(s)) {
        return '—';
      }
      bi = BigInt(s);
    }
    const forceAbs = options?.absolute === true;
    const neg = !forceAbs && bi < 0n;
    const abs = bi < 0n ? -bi : bi;
    const whole = abs / 100n;
    const frac = abs % 100n;
    const wholeStr = whole.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    const fracStr = frac.toString().padStart(2, '0');
    const body = `${wholeStr},${fracStr}`;
    return neg ? `-R$ ${body}` : `R$ ${body}`;
  } catch {
    return '—';
  }
}

/** Valor em reais (ex.: 12.5) para centavos inteiros. */
export function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}

/** Centavos (string ou número da API) para texto em reais em formulários (ex.: "12.50"). */
export function centsToReaisInput(cents: string | number | null | undefined): string {
  if (cents == null || cents === '') {
    return '';
  }
  const n = typeof cents === 'string' ? parseInt(cents, 10) : cents;
  if (!Number.isFinite(n)) {
    return '';
  }
  return (n / 100).toFixed(2);
}
