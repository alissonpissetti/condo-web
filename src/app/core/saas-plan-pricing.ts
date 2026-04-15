import type { SaasPlanCatalogEntry } from './saas-plans-api.service';

/** Preço por unidade para um dado total de unidades (faixas ou preço único). */
export function pricePerUnitForUnitCount(
  plan: SaasPlanCatalogEntry,
  unitCount: number,
): number {
  const n = Math.max(1, Math.floor(unitCount));
  const tiers = plan.unitPriceTiers;
  if (!tiers?.length) {
    return plan.pricePerUnitCents;
  }
  const sorted = [...tiers].sort((a, b) => a.minUnits - b.minUnits);
  for (const t of sorted) {
    if (n >= t.minUnits && (t.maxUnits == null || n <= t.maxUnits)) {
      return t.pricePerUnitCents;
    }
  }
  return plan.pricePerUnitCents;
}

export function totalMonthlyCentsForUnits(
  plan: SaasPlanCatalogEntry,
  unitCount: number,
): number {
  const u = Math.max(1, Math.floor(unitCount));
  return pricePerUnitForUnitCount(plan, u) * u;
}
