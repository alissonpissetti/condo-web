import type { CondoAccess } from './planning-api.service';

/** Titular da conta ou papéis de gestão do condomínio (síndico, subsíndico, administrador). */
export function condoAccessAllowsManagement(access: CondoAccess): boolean {
  if (access.kind === 'owner') {
    return true;
  }
  if (access.kind === 'participant') {
    return (
      access.role === 'syndic' ||
      access.role === 'sub_syndic' ||
      access.role === 'admin'
    );
  }
  return false;
}
