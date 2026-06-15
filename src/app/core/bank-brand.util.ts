import { svgBanco } from './bank-svg-banco';
import {
  BRAZILIAN_BANKS,
  type BrazilianBankEntry,
} from './brazilian-banks.catalog';

/** Slugs com SVG em `@edusites/bancos-brasil` (v1.2+). */
const KNOWN_LOGO_SLUGS = new Set(
  BRAZILIAN_BANKS.map((b) => b.logoSlug).filter((s): s is string => Boolean(s)),
);

function normalizeBankName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * SVG quadrado do banco (fundo + monograma da marca), pronto para `innerHTML` sanitizado.
 */
export function bankLogoSvg(
  entry: BrazilianBankEntry,
  sizePx: number,
): string | null {
  if (!entry.logoSlug || !KNOWN_LOGO_SLUGS.has(entry.logoSlug)) {
    return null;
  }
  return (
    svgBanco({
      nome: entry.logoSlug,
      tamanho: sizePx,
      formato: 'quadrado',
      fundo: entry.brandColor,
      cor: entry.brandTextColor,
    }) ?? null
  );
}

/** @deprecated Preferir `bankLogoSvg`; mantido para compatibilidade pontual. */
export function bankLogoUrl(entry: BrazilianBankEntry): string | null {
  if (!entry.logoSlug || !KNOWN_LOGO_SLUGS.has(entry.logoSlug)) {
    return null;
  }
  return `https://cdn.jsdelivr.net/npm/@edusites/bancos-brasil@1.0.0/icons/${entry.logoSlug}.svg`;
}

export function findBrazilianBank(
  bankName: string | null | undefined,
): BrazilianBankEntry | null {
  const raw = bankName?.trim();
  if (!raw) {
    return null;
  }
  const norm = normalizeBankName(raw);
  const exact = BRAZILIAN_BANKS.find(
    (b) => normalizeBankName(b.name) === norm,
  );
  if (exact) {
    return exact;
  }
  const byCompe = norm.match(/^\d{3}$/)
    ? BRAZILIAN_BANKS.find((b) => b.compe === norm)
    : null;
  if (byCompe) {
    return byCompe;
  }
  return (
    BRAZILIAN_BANKS.find((b) => {
      const bn = normalizeBankName(b.name);
      return bn.startsWith(norm) || norm.startsWith(bn);
    }) ?? null
  );
}

export function filterBrazilianBanks(query: string): BrazilianBankEntry[] {
  const q = normalizeBankName(query);
  if (!q) {
    return [...BRAZILIAN_BANKS];
  }
  return BRAZILIAN_BANKS.filter(
    (b) =>
      normalizeBankName(b.name).includes(q) ||
      b.compe.includes(q) ||
      b.initials.toLowerCase().includes(q) ||
      (b.logoSlug?.includes(q) ?? false),
  );
}
