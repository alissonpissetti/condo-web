/**
 * Wrapper tipado sobre o vendor MIT em `vendor/bancos-brasil/`
 * (não usar `@edusites/bancos-brasil` no app — o entrypoint npm puxa Vue).
 */
import { svgBanco as svgBancoVendor } from './vendor/bancos-brasil/core.js';

export type BankSvgBancoOptions = {
  nome: string;
  cor?: string;
  fundo?: string;
  formato?: string;
  tamanho?: number;
  className?: string;
};

export function svgBanco(options: BankSvgBancoOptions): string | null {
  return svgBancoVendor(options) ?? null;
}
