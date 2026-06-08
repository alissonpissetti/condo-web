import type { CondominiumSupplier } from './condominium-works-api.service';

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
