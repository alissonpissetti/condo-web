import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Extrai até 11 dígitos nacionais (DDD + número), removendo 55 inicial se existir. */
export function toNationalPhoneDigits(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) {
    d = d.slice(2);
  }
  return d.slice(0, 11);
}

/**
 * Como {@link toNationalPhoneDigits}, mas só mantém dígitos após o DDD se o número for móvel (9 + 8 dígitos).
 */
export function toMobileNationalPhoneDigits(input: string): string {
  let d = toNationalPhoneDigits(input);
  if (d.length > 2 && d[2] !== '9') {
    d = d.slice(0, 2);
  }
  return d.slice(0, 11);
}

/** Vazio é válido; se houver dígitos, exige celular BR completo (11 dígitos, 9 após DDD). */
export function optionalBrMobilePhoneValidator(
  control: AbstractControl,
): ValidationErrors | null {
  const v = String(control.value ?? '').replace(/\D/g, '');
  if (v.length === 0) {
    return null;
  }
  if (v.length !== 11 || v[2] !== '9') {
    return { brMobilePhone: true };
  }
  return null;
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
