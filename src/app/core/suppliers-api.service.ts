import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type SupplierPixKeyType =
  | 'cpf'
  | 'cnpj'
  | 'email'
  | 'phone'
  | 'random';

export const SUPPLIER_PIX_TYPE_OPTIONS: {
  value: SupplierPixKeyType;
  label: string;
}[] = [
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'random', label: 'Chave aleatória (EVP)' },
];

export interface SupplierCategory {
  id: string;
  name: string;
  createdByUserId: string | null;
  createdAt: string;
}

export interface Supplier {
  id: string;
  condominiumId: string;
  categoryId: string;
  name: string;
  legalName: string | null;
  documentCnpjCpf: string | null;
  pixKeyType: SupplierPixKeyType | null;
  pixKeyValue: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  addressLine: string | null;
  createdAt: string;
  updatedAt: string;
  category?: SupplierCategory;
}

export type CreateSupplierPayload = {
  categoryId: string;
  name: string;
  legalName?: string | null;
  documentCnpjCpf?: string | null;
  pixKeyType?: string | null;
  pixKeyValue?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  addressLine?: string | null;
};

export type UpdateSupplierPayload = Partial<CreateSupplierPayload>;

@Injectable({ providedIn: 'root' })
export class SuppliersApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  listCategories(condominiumId: string): Observable<SupplierCategory[]> {
    return this.http.get<SupplierCategory[]>(
      `${this.base}/condominiums/${condominiumId}/supplier-categories`,
    );
  }

  createCategory(
    condominiumId: string,
    name: string,
  ): Observable<SupplierCategory> {
    return this.http.post<SupplierCategory>(
      `${this.base}/condominiums/${condominiumId}/supplier-categories`,
      { name },
    );
  }

  listSuppliers(
    condominiumId: string,
    categoryId?: string,
  ): Observable<Supplier[]> {
    let params = new HttpParams();
    if (categoryId?.trim()) {
      params = params.set('categoryId', categoryId.trim());
    }
    return this.http.get<Supplier[]>(
      `${this.base}/condominiums/${condominiumId}/suppliers`,
      { params },
    );
  }

  createSupplier(
    condominiumId: string,
    body: CreateSupplierPayload,
  ): Observable<Supplier> {
    return this.http.post<Supplier>(
      `${this.base}/condominiums/${condominiumId}/suppliers`,
      body,
    );
  }

  updateSupplier(
    condominiumId: string,
    supplierId: string,
    body: UpdateSupplierPayload,
  ): Observable<Supplier> {
    return this.http.patch<Supplier>(
      `${this.base}/condominiums/${condominiumId}/suppliers/${supplierId}`,
      body,
    );
  }

  deleteSupplier(condominiumId: string, supplierId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/condominiums/${condominiumId}/suppliers/${supplierId}`,
    );
  }
}
