/**
 * Normaliza número do imóvel: até 8 dígitos + 1 letra opcional, ou S/N.
 * Valor no FormControl sem hífen (ex.: `123`, `1234A`, `S/N`).
 */
export function parseAddressNumberInput(raw: string): string {
  const compact = raw.trim().toUpperCase().replace(/\s/g, '');
  if (compact === 'S/N' || compact === 'SN') {
    return 'S/N';
  }
  const alnum = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = alnum.match(/^(\d{1,8})([A-Z])?$/);
  if (m) {
    return m[2] ? `${m[1]}${m[2]}` : m[1];
  }
  if (alnum === 'SN') {
    return 'S/N';
  }
  return raw.replace(/\D/g, '').slice(0, 8);
}

/** Exibe com hífen antes da letra final: `1234-A`, só dígitos ou `S/N`. */
export function formatAddressNumberDisplay(stored: string): string {
  if (!stored) {
    return '';
  }
  if (stored === 'S/N') {
    return 'S/N';
  }
  const m = stored.match(/^(\d{1,8})([A-Z])$/);
  if (m) {
    return `${m[1]}-${m[2]}`;
  }
  return stored.replace(/\D/g, '').slice(0, 8);
}
