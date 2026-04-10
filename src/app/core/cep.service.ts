import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CepLookupData {
  zip: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

@Injectable({ providedIn: 'root' })
export class CepService {
  private readonly http = inject(HttpClient);

  lookup(cepDigits: string): Observable<CepLookupData> {
    return this.http
      .get<{ data: CepLookupData }>(`${environment.apiUrl}/cep/${cepDigits}`)
      .pipe(map((r) => r.data));
  }
}
