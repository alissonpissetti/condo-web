/** Extrai até 11 dígitos nacionais (DDD + número), removendo 55 inicial se existir. */
export function toNationalPhoneDigits(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) {
    d = d.slice(2);
  }
  return d.slice(0, 11);
}

/** Máscara visual (XX) XXXXX-XXXX para móvel ou (XX) XXXX-XXXX para fixo. */
export function formatBrPhoneDisplay(digitsNational: string): string {
  const clean = toNationalPhoneDigits(digitsNational);
  if (clean.length === 0) {
    return '';
  }
  const ddd = clean.slice(0, 2);
  const rest = clean.slice(2);
  if (clean.length <= 2) {
    return `(${clean}`;
  }
  if (rest.length === 0) {
    return `(${ddd})`;
  }
  const isMobile = rest[0] === '9';
  if (isMobile) {
    if (rest.length <= 5) {
      return `(${ddd}) ${rest}`;
    }
    return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
  }
  if (rest.length <= 4) {
    return `(${ddd}) ${rest}`;
  }
  return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4, 8)}`;
}
