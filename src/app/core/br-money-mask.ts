import { parseReaisInputToCents } from './money-brl';

/** Apenas dígitos (centavos inteiros acumulados na digitação). */
export function toMoneyMaskDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, 15);
}

/** Exibe dígitos (centavos) como moeda pt-BR (ex.: 542000 → "5.420,00"). */
export function formatMoneyMaskDisplay(digits: string): string {
  const d = toMoneyMaskDigits(digits);
  if (!d) {
    return '';
  }
  const cents = Number.parseInt(d, 10);
  if (!Number.isFinite(cents)) {
    return '';
  }
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Converte valor de formulário (mascarado ou não) para dígitos de centavos. */
export function moneyMaskDigitsFromDisplay(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) {
    return '';
  }
  const cents = parseReaisInputToCents(raw);
  return cents == null ? toMoneyMaskDigits(raw) : String(cents);
}
