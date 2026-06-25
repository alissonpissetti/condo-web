import { Observable, of, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Supplier, SuppliersApiService } from './suppliers-api.service';

export type EnsureSupplierByNameInput = {
  name: string;
  pixKeyType: string | null;
  pixKeyValue: string | null;
  existingSuppliers: Pick<Supplier, 'id' | 'name'>[];
  defaultCategoryId: string | null;
};

/** Cria ou reutiliza fornecedor pelo nome; atualiza PIX se informado. */
export function ensureSupplierByName$(
  api: SuppliersApiService,
  condominiumId: string,
  input: EnsureSupplierByNameInput,
): Observable<Supplier> {
  const name = input.name.trim();
  if (!name) {
    return throwError(() => new Error('Nome do fornecedor inválido.'));
  }

  const pixType = input.pixKeyType?.trim() || null;
  const pixVal = input.pixKeyValue?.trim() || null;
  const existing = input.existingSuppliers.find(
    (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
  );

  if (existing) {
    if (pixType && pixVal) {
      return api.updateSupplier(condominiumId, existing.id, {
        pixKeyType: pixType,
        pixKeyValue: pixVal,
      });
    }
    return of(existing as Supplier);
  }

  const categoryId = input.defaultCategoryId;
  if (!categoryId) {
    return throwError(
      () => new Error('Categoria padrão de fornecedor indisponível.'),
    );
  }

  return api.createSupplier(condominiumId, {
    categoryId,
    name,
    pixKeyType: pixType,
    pixKeyValue: pixVal,
  });
}

/** Valida par tipo/valor PIX em cadastro manual. */
export function validateManualSupplierPix(
  pixType: string,
  pixVal: string,
): string | null {
  const t = pixType.trim();
  const v = pixVal.trim();
  if ((t && !v) || (!t && v)) {
    return 'Chave PIX: informe o tipo e o valor juntos, ou deixe os dois em branco.';
  }
  return null;
}

/** Resolve supplierId quando o usuário digita o nome manualmente. */
export function resolveManualSupplierId$(
  api: SuppliersApiService,
  condominiumId: string,
  input: EnsureSupplierByNameInput,
): Observable<string> {
  return ensureSupplierByName$(api, condominiumId, input).pipe(
    map((s) => s.id),
  );
}

/** Nenhum cadastro manual — retorna undefined. */
export function optionalManualSupplierId$(
  api: SuppliersApiService,
  condominiumId: string,
  supplierId: string,
  supplierName: string,
  pixType: string,
  pixVal: string,
  existingSuppliers: Pick<Supplier, 'id' | 'name'>[],
  defaultCategoryId: string | null,
): Observable<string | undefined> {
  const id = supplierId.trim();
  if (id) {
    return of(id);
  }
  const name = supplierName.trim();
  if (!name) {
    return of(undefined);
  }
  return resolveManualSupplierId$(api, condominiumId, {
    name,
    pixKeyType: pixType.trim() || null,
    pixKeyValue: pixVal.trim() || null,
    existingSuppliers,
    defaultCategoryId,
  });
}
