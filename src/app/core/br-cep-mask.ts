/** Apenas dígitos, no máximo 8. */
export function toCepDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, 8);
}

/** Máscara visual 00000-000 */
export function formatCepDisplay(digits: string): string {
  const d = digits.slice(0, 8);
  if (d.length <= 5) {
    return d;
  }
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
