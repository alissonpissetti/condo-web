import type { CondominiumSupplier } from './condominium-works-api.service';
import { SUPPLIER_PIX_TYPE_OPTIONS } from './suppliers-api.service';

export function supplierSelectLabel(
  supplier: Pick<CondominiumSupplier, 'name' | 'contactName'>,
): string {
  const contact = supplier.contactName?.trim();
  return contact ? `${supplier.name} — ${contact}` : supplier.name;
}

export function supplierWhatsAppGreetingName(
  supplier: Pick<CondominiumSupplier, 'name' | 'contactName'>,
): string {
  return supplier.contactName?.trim() || supplier.name.trim();
}

export function supplierPixTypeLabelPt(
  t: string | null | undefined,
): string {
  return SUPPLIER_PIX_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? 'PIX';
}
