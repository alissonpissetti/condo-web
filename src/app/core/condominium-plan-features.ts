/**
 * Chaves canônicas dos módulos habilitados por plano (sincronizadas com
 * `condo-api/src/platform/saas-plan-features.ts` e
 * `condo-adm/src/app/core/platform-api.service.ts`).
 */
export const SAAS_PLAN_FEATURE_KEYS = [
  'editCondominium',
  'units',
  'invitations',
  'members',
  'unitShortcuts',
  'financialTransactions',
  'financialStatement',
  'funds',
  'condoFees',
  'planning',
  'documents',
] as const;

export type SaasPlanFeatureKey = (typeof SAAS_PLAN_FEATURE_KEYS)[number];

export type SaasPlanFeatures = Record<SaasPlanFeatureKey, boolean>;

export const SAAS_PLAN_FEATURE_LABELS: Record<SaasPlanFeatureKey, string> = {
  editCondominium: 'Editar condomínio',
  units: 'Unidades',
  invitations: 'Convites',
  members: 'Membros',
  unitShortcuts: 'Atalhos por unidade',
  financialTransactions: 'Transações financeiras',
  financialStatement: 'Extrato',
  funds: 'Fundos',
  condoFees: 'Taxas condominiais',
  planning: 'Pautas / planejamento',
  documents: 'Documentos',
};

export function defaultSaasPlanFeatures(): SaasPlanFeatures {
  const out = {} as SaasPlanFeatures;
  for (const k of SAAS_PLAN_FEATURE_KEYS) {
    out[k] = true;
  }
  return out;
}

/**
 * Preenche chaves ausentes/inválidas com `true` (plano legado sem restrição).
 * Plano `null` ou `undefined` também resulta em «tudo liberado».
 */
export function normalizeSaasPlanFeatures(
  raw: Partial<Record<string, unknown>> | null | undefined,
): SaasPlanFeatures {
  const out = defaultSaasPlanFeatures();
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  for (const k of SAAS_PLAN_FEATURE_KEYS) {
    const v = raw[k];
    if (typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}
