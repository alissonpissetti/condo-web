import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SaasPlanPriceTier {
  minUnits: number;
  maxUnits: number | null;
  pricePerUnitCents: number;
}

export interface SaasPlanCatalogEntry {
  id: number;
  name: string;
  pricePerUnitCents: number;
  /** Faixas de preço por total de unidades; null = só `pricePerUnitCents`. */
  unitPriceTiers?: SaasPlanPriceTier[] | null;
  currency: string;
  isDefault: boolean;
  /** Texto público; uma linha por destaque (opcional). */
  catalogBlurb?: string | null;
}

@Injectable({ providedIn: 'root' })
export class SaasPlansApiService {
  private readonly http = inject(HttpClient);

  listCatalog(): Observable<SaasPlanCatalogEntry[]> {
    return this.http.get<SaasPlanCatalogEntry[]>(
      `${environment.apiUrl}/saas-plans/catalog`,
    );
  }
}
