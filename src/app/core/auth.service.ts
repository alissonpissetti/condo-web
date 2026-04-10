import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'condo_access_token';

export interface LoginResponse {
  access_token: string;
}

export interface SmsLoginRequestResponse {
  ok: true;
  message: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  createdAt: string;
}

export interface MePersonProfile {
  id: string;
  fullName: string;
  cpf: string | null;
  phone: string | null;
  addressZip: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressNeighborhood: string | null;
  addressCity: string | null;
  addressState: string | null;
  createdAt: string;
}

export interface MeProfile {
  id: string;
  email: string;
  phone: string | null;
  createdAt: string;
  person: MePersonProfile | null;
}

export interface UpdateMePersonPayload {
  fullName?: string;
  cpf?: string;
  addressZip?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  addressNeighborhood?: string;
  addressCity?: string;
  addressState?: string;
}

export interface Condominium {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly tokenSignal = signal<string | null>(this.readToken());

  readonly token = this.tokenSignal.asReadonly();
  readonly isAuthenticated = computed(() => !!this.tokenSignal());

  private readToken(): string | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage.getItem(TOKEN_KEY);
  }

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/login`, {
        email,
        password,
      })
      .pipe(
        tap((res) => {
          localStorage.setItem(TOKEN_KEY, res.access_token);
          this.tokenSignal.set(res.access_token);
        }),
      );
  }

  requestSmsLogin(phone: string): Observable<SmsLoginRequestResponse> {
    return this.http.post<SmsLoginRequestResponse>(
      `${environment.apiUrl}/auth/sms/request`,
      { phone },
    );
  }

  verifySmsLogin(phone: string, code: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/sms/verify`, {
        phone,
        code,
      })
      .pipe(
        tap((res) => {
          localStorage.setItem(TOKEN_KEY, res.access_token);
          this.tokenSignal.set(res.access_token);
        }),
      );
  }

  register(
    email: string,
    password: string,
    phone: string,
  ): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(
      `${environment.apiUrl}/auth/register`,
      { email, password, phone },
    );
  }

  getMe(): Observable<MeProfile> {
    return this.http.get<MeProfile>(`${environment.apiUrl}/users/me`);
  }

  updateMe(body: {
    email: string;
    phone: string;
    currentPassword?: string;
    newPassword?: string;
    person?: UpdateMePersonPayload;
  }): Observable<MeProfile> {
    return this.http.patch<MeProfile>(`${environment.apiUrl}/users/me`, body);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.tokenSignal.set(null);
    void this.router.navigateByUrl('/');
  }

  listCondominiums(): Observable<Condominium[]> {
    return this.http.get<Condominium[]>(`${environment.apiUrl}/condominiums`);
  }

  createCondominium(name: string): Observable<Condominium> {
    return this.http.post<Condominium>(`${environment.apiUrl}/condominiums`, {
      name,
    });
  }
}
