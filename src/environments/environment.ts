export const environment = {
  production: false,
  /** Base URL da condo-api (Nest). */
  apiUrl: 'http://localhost:3000',
  /**
   * Convites por email: na API, defina INVITE_PUBLIC_URL para esta app com o path de registo,
   * ex.: http://localhost:4200/auth/register — o email acrescenta ?inviteToken=...
   * O mesmo contrato serve para deep link no condo-app no futuro.
   */
};
