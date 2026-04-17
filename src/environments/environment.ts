export const environment = {
  production: false,
  /** Base URL da condo-api (Nest). */
  apiUrl: 'http://localhost:3000',
  /**
   * Convites: na API use FRONTEND_PUBLIC_URL = esta origem (ex.: http://localhost:4200).
   * Links: {FRONTEND_PUBLIC_URL}/invitations/{token} → rota `invitations/:token` redireciona ao cadastro.
   */
};
