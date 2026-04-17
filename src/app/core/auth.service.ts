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

export interface PasswordResetRequestResponse {
  ok: true;
  message: string;
}

export interface PasswordResetVerifyResponse {
  reset_token: string;
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
  /** Plano SaaS gravado no condomínio; ausente ou null = fallback (titular / padrão). */
  saasPlanId?: number | null;
  /** Plano efetivo para faturamento (listagem enriquecida). */
  billingPlanId?: number;
  billingPlanName?: string;
  billingPricePerUnitCents?: number;
  /**
   * Mapa de módulos habilitados pelo plano efetivo. Chaves ausentes são
   * tratadas como habilitadas (planos legados sem restrição).
   */
  billingPlanFeatures?: Partial<Record<string, boolean>> | null;
  createdAt: string;
  updatedAt: string;
  /** Listagem: existe participante com papel síndico. */
  hasSyndic?: boolean;
  /** Nome completo no perfil da pessoa; nunca e-mail. */
  syndicName?: string | null;
  /** Detalhe GET :id — cobrança / PDF de transparência. */
  billingPixKey?: string | null;
  billingPixBeneficiaryName?: string | null;
  billingPixCity?: string | null;
  /** Incluir QR Code e «Copia e cola» PIX no PDF de transparência (senão só chave em texto). */
  transparencyPdfIncludePixQrCode?: boolean;
  syndicWhatsappForReceipts?: string | null;
  managementLogoStorageKey?: string | null;
  /** Modelo de cobrança em uso (hoje apenas `manual_pix`). */
  billingChargeModel?: string;
  /** Dia do mês (1..31) sugerido como vencimento padrão da taxa. */
  billingDefaultDueDay?: number;
  /** Juros aplicados em atraso em basis points (1 bp = 0,01 %). */
  billingLateInterestBps?: number;
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

  requestPasswordReset(
    body:
      | { channel: 'email'; email: string }
      | { channel: 'sms'; phone: string },
  ): Observable<PasswordResetRequestResponse> {
    return this.http.post<PasswordResetRequestResponse>(
      `${environment.apiUrl}/auth/password-reset/request`,
      body,
    );
  }

  verifyPasswordReset(
    body:
      | { channel: 'email'; email: string; code: string }
      | { channel: 'sms'; phone: string; code: string },
  ): Observable<PasswordResetVerifyResponse> {
    return this.http.post<PasswordResetVerifyResponse>(
      `${environment.apiUrl}/auth/password-reset/verify`,
      body,
    );
  }

  completePasswordReset(
    resetToken: string,
    newPassword: string,
  ): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(
      `${environment.apiUrl}/auth/password-reset/complete`,
      { reset_token: resetToken, newPassword },
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

  createCondominium(name: string, planId: number): Observable<Condominium> {
    return this.http.post<Condominium>(`${environment.apiUrl}/condominiums`, {
      name,
      planId,
    });
  }

  patchCondominium(
    id: string,
    body: {
      name?: string;
      planId?: number;
      billingPixKey?: string;
      billingPixBeneficiaryName?: string;
      billingPixCity?: string;
      transparencyPdfIncludePixQrCode?: boolean;
      syndicWhatsappForReceipts?: string;
    },
  ): Observable<Condominium> {
    return this.http.patch<Condominium>(
      `${environment.apiUrl}/condominiums/${id}`,
      body,
    );
  }

  deleteCondominium(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/condominiums/${id}`);
  }
}
