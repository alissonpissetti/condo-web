import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Resposta de GET /condominiums/:id/saas-billing-preview */
export interface SaasBillingPreview {
  condominiumId: string;
  unitCount: number;
  planId: number;
  planName: string;
  pricePerUnitCents: number;
  baseMonthlyCents: number;
  discountPercent: number;
  appliedVoucherIds: string[];
  appliedLabels: string[];
  monthlyCents: number;
  currency: string;
  referenceMonth: string;
}

export interface CondominiumVoucherResponse {
  voucher: {
    id: string;
    name: string;
    code: string;
    discountPercent: number;
    validFrom: string;
    validTo: string;
    active: boolean;
  } | null;
}

@Injectable({ providedIn: 'root' })
export class CondominiumSaasApiService {
  private readonly http = inject(HttpClient);

  getBillingPreview(
    condominiumId: string,
    referenceMonth?: string,
  ): Observable<SaasBillingPreview> {
    let params = new HttpParams();
    if (referenceMonth?.trim()) {
      params = params.set('referenceMonth', referenceMonth.trim());
    }
    return this.http.get<SaasBillingPreview>(
      `${environment.apiUrl}/condominiums/${condominiumId}/saas-billing-preview`,
      { params },
    );
  }

  getVoucher(condominiumId: string): Observable<CondominiumVoucherResponse> {
    return this.http.get<CondominiumVoucherResponse>(
      `${environment.apiUrl}/condominiums/${condominiumId}/voucher`,
    );
  }

  patchVoucher(
    condominiumId: string,
    body: { code: string | null },
  ): Observable<CondominiumVoucherResponse> {
    return this.http.patch<CondominiumVoucherResponse>(
      `${environment.apiUrl}/condominiums/${condominiumId}/voucher`,
      body,
    );
  }
}
