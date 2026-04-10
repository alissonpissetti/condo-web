/** Lê o `sub` do JWT (payload) só para apresentação — não usar para decisões de segurança. */
export function readJwtSub(token: string | null): string | null {
  if (!token) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const json = atob(base64);
    const payload = JSON.parse(json) as { sub?: string };
    const sub = payload.sub?.trim();
    return sub?.length ? sub : null;
  } catch {
    return null;
  }
}
